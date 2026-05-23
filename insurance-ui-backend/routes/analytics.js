const express = require('express');
const logger = require('../utils/logger');
const { executeQuery } = require('../config/realDatabase');

const router = express.Router();

/**
 * GET /api/analytics/dashboard
 * Get main dashboard analytics data
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    logger.info('Fetching dashboard analytics');

    const conversationMetrics = await getConversationMetrics();

    // Get user metrics
    const userQuery = `SELECT COUNT(*) as total_users FROM app_users`;
    const userResults = await executeQuery(userQuery);
    const totalUsers = userResults[0]?.total_users || 0;

    // Get policy metrics
    const policyQuery = `
      SELECT 
        COUNT(*) as total_policies,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_policies,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_policies,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_policies,
        SUM(CASE WHEN status = 'active' THEN premium_amount ELSE 0 END) as total_active_premium
      FROM policies
    `;
    const policyResults = await executeQuery(policyQuery);
    const policyMetrics = policyResults[0];

    // Get claims metrics
    const claimsQuery = `
      SELECT 
        COUNT(*) as total_claims,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_claims,
        COUNT(CASE WHEN status = 'settled' THEN 1 END) as settled_claims,
        COUNT(CASE WHEN status = 'denied' THEN 1 END) as denied_claims,
        SUM(estimated_loss) as total_estimated_loss
      FROM claims
    `;
    const claimsResults = await executeQuery(claimsQuery);
    const claimsMetrics = claimsResults[0];

    // Get billing metrics
    const billingQuery = `
      SELECT 
        COUNT(*) as total_bills,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_bills,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_bills,
        COUNT(CASE WHEN status = 'overdue' THEN 1 END) as overdue_bills,
        SUM(amount_due) as total_amount_due,
        SUM(CASE WHEN status = 'paid' THEN amount_due ELSE 0 END) as total_paid
      FROM billing
    `;
    const billingResults = await executeQuery(billingQuery);
    const billingMetrics = billingResults[0];

    // Get recent activity (last 30 days)
    const recentActivityQuery = `
      SELECT 
        'policies' as type,
        COUNT(*) as count,
        date('now', '-30 days') as period_start
      FROM policies
      WHERE start_date >= date('now', '-30 days')
      
      UNION ALL
      
      SELECT 
        'claims' as type,
        COUNT(*) as count,
        date('now', '-30 days') as period_start
      FROM claims
      WHERE claim_date >= date('now', '-30 days')
      
      UNION ALL
      
      SELECT 
        'billing' as type,
        COUNT(*) as count,
        date('now', '-30 days') as period_start
      FROM billing
      WHERE billing_date >= date('now', '-30 days')
    `;
    const recentActivity = await executeQuery(recentActivityQuery);

    res.json({
      success: true,
      data: {
        conversations: conversationMetrics,
        policies: {
          total: policyMetrics.total_policies,
          active: policyMetrics.active_policies,
          expired: policyMetrics.expired_policies,
          cancelled: policyMetrics.cancelled_policies,
          totalActivePremium: parseFloat(policyMetrics.total_active_premium || 0).toFixed(2)
        },
        claims: {
          total: claimsMetrics.total_claims,
          open: claimsMetrics.open_claims,
          settled: claimsMetrics.settled_claims,
          denied: claimsMetrics.denied_claims,
          totalEstimatedLoss: parseFloat(claimsMetrics.total_estimated_loss || 0).toFixed(2)
        },
        billing: {
          total: billingMetrics.total_bills,
          paid: billingMetrics.paid_bills,
          pending: billingMetrics.pending_bills,
          overdue: billingMetrics.overdue_bills,
          totalAmountDue: parseFloat(billingMetrics.total_amount_due || 0).toFixed(2),
          totalPaid: parseFloat(billingMetrics.total_paid || 0).toFixed(2)
        },
        recentActivity: recentActivity.reduce((acc, item) => {
          acc[item.type] = item.count;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    logger.error('Dashboard analytics error:', error);
    next(error);
  }
});

/**
 * GET /api/analytics/conversations
 * Get conversation analytics data
 */
router.get('/conversations', async (req, res, next) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;

    logger.info('Fetching conversation analytics');
    const analytics = await getConversationAnalytics({ startDate, endDate, groupBy });

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    logger.error('Conversation analytics error:', error);
    next(error);
  }
});

/**
 * GET /api/analytics/agents
 * Get agent performance analytics
 */
router.get('/agents', async (req, res, next) => {
  try {
    logger.info('Fetching agent analytics');
    const agentAnalytics = await getAgentAnalytics();

    res.json({
      success: true,
      data: agentAnalytics
    });

  } catch (error) {
    logger.error('Agent analytics error:', error);
    next(error);
  }
});

/**
 * GET /api/analytics/customer-satisfaction
 * Get customer satisfaction metrics
 */
router.get('/customer-satisfaction', async (req, res, next) => {
  try {
    logger.info('Fetching customer satisfaction analytics');

    res.json({
      success: true,
      data: {
        available: false,
        overall: null,
        byCategory: {},
        trends: [],
        feedback: {
          positive: 0,
          neutral: 0,
          negative: 0
        }
      }
    });

  } catch (error) {
    logger.error('Customer satisfaction analytics error:', error);
    next(error);
  }
});

async function getConversationMetrics() {
  const sessions = await executeQuery(
    `SELECT session_id as sessionId, created_at as createdAt, updated_at as updatedAt, escalated
     FROM chat_sessions`
  );

  const now = Date.now();
  const activeWindowMs = 15 * 60 * 1000;

  const totalConversations = sessions.length;
  const activeConversations = sessions.filter((s) => {
    const t = Date.parse(s.updatedAt);
    if (Number.isNaN(t)) return false;
    return now - t <= activeWindowMs;
  }).length;
  const escalatedConversations = sessions.filter((s) => !!s.escalated).length;

  const responsePairs = await executeQuery(
    `SELECT m.session_id as sessionId,
            m.timestamp as agentTs,
            m.agent_type as agentType,
            (SELECT MAX(u.timestamp)
             FROM chat_messages u
             WHERE u.session_id = m.session_id
               AND u.type = 'user'
               AND u.timestamp < m.timestamp) as userTs
     FROM chat_messages m
     WHERE m.type = 'agent'
     ORDER BY m.timestamp DESC
     LIMIT 2000`
  );

  const deltas = responsePairs
    .map((p) => {
      const u = Date.parse(p.userTs);
      const a = Date.parse(p.agentTs);
      if (Number.isNaN(u) || Number.isNaN(a)) return null;
      const d = (a - u) / 1000;
      return d >= 0 ? d : null;
    })
    .filter((v) => v !== null);

  const avgSeconds = deltas.length ? deltas.reduce((s, v) => s + v, 0) / deltas.length : null;

  return {
    totalConversations,
    activeConversations,
    escalatedConversations,
    avgResponseTime: avgSeconds === null ? null : `${avgSeconds.toFixed(1)}s`
  };
}

function normalizeDateInput(value, fallback) {
  if (!value) return fallback;
  const t = Date.parse(value);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

function dateKeyForGroup(date, groupBy) {
  const d = new Date(date);
  if (groupBy === 'month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  if (groupBy === 'week') {
    const day = d.getUTCDay();
    const diff = (day + 6) % 7;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
    return monday.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

async function getConversationAnalytics({ startDate, endDate, groupBy }) {
  const startIso = normalizeDateInput(startDate, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  const endIso = normalizeDateInput(endDate, new Date().toISOString());

  const sessions = await executeQuery(
    `SELECT session_id as sessionId, created_at as createdAt, updated_at as updatedAt, escalated
     FROM chat_sessions
     WHERE created_at >= ? AND created_at <= ?`,
    [startIso, endIso]
  );

  const buckets = new Map();
  sessions.forEach((s) => {
    const key = dateKeyForGroup(s.createdAt, groupBy);
    if (!buckets.has(key)) {
      buckets.set(key, { date: key, conversations: 0, resolved: 0, escalated: 0, avgResponseTime: null });
    }
    const bucket = buckets.get(key);
    bucket.conversations += 1;
    if (s.escalated) bucket.escalated += 1;
  });

  buckets.forEach((b) => {
    b.resolved = b.conversations - b.escalated;
  });

  const keys = Array.from(buckets.keys()).sort();
  const conversations = keys.map((k) => buckets.get(k));

  const summary = {
    totalConversations: conversations.reduce((sum, item) => sum + item.conversations, 0),
    avgConversationsPerDay: conversations.length
      ? Math.round(conversations.reduce((sum, item) => sum + item.conversations, 0) / conversations.length)
      : 0,
    peakDay: conversations.length
      ? conversations.reduce((max, item) => (item.conversations > max.conversations ? item : max), conversations[0])
      : null
  };

  return { conversations, summary };
}

async function getAgentAnalytics() {
  const agents = await executeQuery(
    `SELECT agent_type as agent, COUNT(*) as totalInteractions,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successfulInteractions
     FROM chat_messages
     WHERE type = 'agent' AND agent_type IS NOT NULL
     GROUP BY agent_type
     ORDER BY totalInteractions DESC`
  );

  const responsePairs = await executeQuery(
    `SELECT m.agent_type as agent,
            m.timestamp as agentTs,
            (SELECT MAX(u.timestamp)
             FROM chat_messages u
             WHERE u.session_id = m.session_id
               AND u.type = 'user'
               AND u.timestamp < m.timestamp) as userTs
     FROM chat_messages m
     WHERE m.type = 'agent' AND m.agent_type IS NOT NULL
     ORDER BY m.timestamp DESC
     LIMIT 5000`
  );

  const agentToDeltas = new Map();
  responsePairs.forEach((p) => {
    const u = Date.parse(p.userTs);
    const a = Date.parse(p.agentTs);
    if (Number.isNaN(u) || Number.isNaN(a)) return;
    const d = (a - u) / 1000;
    if (d < 0) return;
    if (!agentToDeltas.has(p.agent)) agentToDeltas.set(p.agent, []);
    agentToDeltas.get(p.agent).push(d);
  });

  const agentRows = agents.map((a) => {
    const deltas = agentToDeltas.get(a.agent) || [];
    const avg = deltas.length ? deltas.reduce((s, v) => s + v, 0) / deltas.length : null;
    return {
      agent: a.agent,
      name: toDisplayName(a.agent),
      totalInteractions: a.totalInteractions,
      successfulInteractions: a.successfulInteractions,
      avgResponseTime: avg === null ? null : Number(avg.toFixed(1)),
      satisfaction: null,
      escalationRate: null
    };
  });

  const summary = {
    totalInteractions: agentRows.reduce((sum, agent) => sum + agent.totalInteractions, 0),
    avgResponseTime: averageOrNull(agentRows.map((a) => a.avgResponseTime)),
    avgSatisfaction: null,
    avgEscalationRate: null
  };

  return { agents: agentRows, summary };
}

function averageOrNull(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (!nums.length) return null;
  return Number((nums.reduce((s, v) => s + v, 0) / nums.length).toFixed(1));
}

function toDisplayName(agent) {
  return String(agent)
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

module.exports = router;
