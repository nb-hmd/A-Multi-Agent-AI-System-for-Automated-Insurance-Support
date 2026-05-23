const express = require('express');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const multiAgentService = require('../services/realMultiAgentIntegration');
const { executeQuery, executeCommand } = require('../config/realDatabase');
const {
  ensureSession,
  addMessage,
  getConversation,
  listSessions,
  escalateConversation,
  deleteOldSessions,
  updateSessionTitle,
} = require('../services/chatStorage');

const router = express.Router();

/**
 * Validation schemas
 */
const chatQuerySchema = Joi.object({
  message: Joi.string().allow('').max(1000).optional(), // Allow empty message if image is present
  sessionId: Joi.string().optional(),
  customerId: Joi.string().allow(null, '').optional(),
  policyNumber: Joi.string().allow(null, '').optional(),
  context: Joi.object().optional()
});

const conversationSchema = Joi.object({
  sessionId: Joi.string().required(),
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0)
});

async function getRecentMessages(sessionId, limit = 10) {
  const rows = await executeQuery(
    `SELECT id, type, content, timestamp,
            agent_type as agentType,
            status,
            next_agent as nextAgent,
            metadata_json as metadataJson
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY timestamp DESC
     LIMIT ?`,
    [sessionId, limit]
  );

  return rows
    .reverse()
    .map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content,
      timestamp: m.timestamp,
      metadata: m.metadataJson ? safeJsonParse(m.metadataJson) : undefined,
      agentType: m.agentType || undefined,
      status: m.status || undefined,
      nextAgent: m.nextAgent || undefined,
    }));
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * POST /api/chat/query
 * Process user chat query through multi-agent system
 */
router.post('/query', async (req, res, next) => {
  try {
    // Validate input
    const { error, value } = chatQuerySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const { message, sessionId, customerId, policyNumber, context = {} } = value;
    
    // Generate or use existing session ID
    const currentSessionId = sessionId || uuidv4();
    
    // Determine title if this is a new session (simple heuristic)
    // We don't set title here for existing sessions to avoid overwriting "New Chat" prematurely
    // We will update it if it's currently "New Chat" and this is the first message
    
    // Determine title candidate
    let titleCandidate = null;
    if (!sessionId || sessionId === currentSessionId) { 
       // If it's a new session or we are just ensuring it
       titleCandidate = message.length > 30 ? message.substring(0, 30) + '...' : message;
    }

    const session = await ensureSession({
      sessionId: currentSessionId,
      customerId: customerId || null,
      policyNumber: policyNumber || null,
      title: titleCandidate, 
    });
    
    // Explicitly update title if it was provided but ensureSession didn't update it
    // (e.g., if titleCandidate was null during ensureSession, but we calculated it)
    // Also, if this is the first message of a "New Chat", force update it.
    if (titleCandidate && (!session.title || session.title === 'New Chat')) {
       await updateSessionTitle({ sessionId: currentSessionId, title: titleCandidate });
    }
    
    // Cleanup old sessions (fire and forget)
    deleteOldSessions().catch(err => logger.error('Error cleaning up old sessions:', err));
    
    // Add user message to conversation
    const userMessage = {
      id: uuidv4(),
      type: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      metadata: {
        customerId: customerId || session.customer_id,
        policyNumber: policyNumber || session.policy_number
      }
    };

    await addMessage({
      id: userMessage.id,
      sessionId: currentSessionId,
      type: 'user',
      content: userMessage.content,
      timestamp: userMessage.timestamp,
      metadata: userMessage.metadata,
    });

    // Prepare context for agent system
    const recentMessages = await getRecentMessages(currentSessionId, 10);
    const agentContext = {
      sessionId: currentSessionId,
      customerId: customerId || session.customer_id,
      policyNumber: policyNumber || session.policy_number,
      conversationHistory: recentMessages,
      ...context
    };

    logger.info(`Processing chat query for session ${currentSessionId}:`, message);

    // Process through multi-agent system
    let agentResponse;
    try {
      agentResponse = await multiAgentService.processQuery(message, agentContext);
    } catch (e) {
      logger.error('Multi-agent processing failed, returning fallback response:', e);
      agentResponse = {
        agent: 'system',
        response: 'The assistant is temporarily unavailable. Please try again in a few seconds.',
        metadata: { error: e.message },
        status: 'error'
      };
    }
    
    // Add agent response to conversation
    const agentMessage = {
      id: uuidv4(),
      type: 'agent',
      content: agentResponse.response || 'I received your message and I\'m processing it.',
      timestamp: new Date().toISOString(),
      metadata: {
        ...(agentResponse.metadata || {}),
        agentType: agentResponse.agent || 'unknown',
        sessionId: currentSessionId,
        nextAgent: agentResponse.next_agent || agentResponse.metadata?.next_agent || null,
        status: agentResponse.status || agentResponse.metadata?.status || 'completed',
        confidence: agentResponse.confidence ?? agentResponse.metadata?.confidence ?? null,
      }
    };

    await addMessage({
      id: agentMessage.id,
      sessionId: currentSessionId,
      type: 'agent',
      content: agentMessage.content,
      timestamp: agentMessage.timestamp,
      agentType: agentMessage.metadata.agentType,
      status: agentMessage.metadata.status,
      nextAgent: agentMessage.metadata.nextAgent,
      metadata: agentMessage.metadata,
    });

    if (agentMessage.metadata?.type === 'escalation' || agentMessage.metadata?.status === 'escalated') {
      await escalateConversation({
        sessionId: currentSessionId,
        reason: agentMessage.metadata?.reason || 'Escalated by assistant',
        priority: agentMessage.metadata?.priority || 'medium',
      });
    }

    const conversation = await getConversation({ sessionId: currentSessionId, limit: 1, offset: 0 });

    res.json({
      success: true,
      data: {
        sessionId: currentSessionId,
        userMessage,
        agentMessage,
        conversation: {
          sessionId: conversation.session.session_id,
          customerId: conversation.session.customer_id,
          policyNumber: conversation.session.policy_number,
          messageCount: conversation.totalMessages,
          createdAt: conversation.session.created_at,
          updatedAt: conversation.session.updated_at
        }
      }
    });

  } catch (error) {
    logger.error('Chat query processing error:', error);
    next(error);
  }
});

/**
 * GET /api/chat/history/:sessionId
 * Get conversation history for a specific session
 */
router.get('/history/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    await ensureSession({ sessionId });

    const conversation = await getConversation({
      sessionId,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({
      success: true,
      data: {
        sessionId,
        messages: conversation.messages,
        totalMessages: conversation.totalMessages,
        customerId: conversation.session.customer_id,
        policyNumber: conversation.session.policy_number,
        createdAt: conversation.session.created_at,
        updatedAt: conversation.session.updated_at
      }
    });

  } catch (error) {
    logger.error('Chat history retrieval error:', error);
    next(error);
  }
});

router.get('/conversation/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    await ensureSession({ sessionId });

    const conversation = await getConversation({
      sessionId,
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({
      success: true,
      data: {
        sessionId,
        messages: conversation.messages,
        totalMessages: conversation.totalMessages,
        customerId: conversation.session.customer_id,
        policyNumber: conversation.session.policy_number,
        createdAt: conversation.session.created_at,
        updatedAt: conversation.session.updated_at
      }
    });
  } catch (error) {
    logger.error('Chat conversation retrieval error:', error);
    next(error);
  }
});

/**
 * GET /api/chat/sessions
 * Get all conversation sessions for current user
 */
router.get('/sessions', async (req, res, next) => {
  try {
    const customerId = req.query.customerId || null;
    const sessions = await listSessions({ customerId });

    res.json({
      success: true,
      data: {
        sessions,
        total: sessions.length
      }
    });

  } catch (error) {
    logger.error('Sessions retrieval error:', error);
    next(error);
  }
});

/**
 * POST /api/chat/escalate
 * Request human escalation for current conversation
 */
router.post('/escalate', async (req, res, next) => {
  try {
    const { sessionId, reason, priority = 'medium' } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Session ID is required'
      });
    }

    await ensureSession({ sessionId });
    
    // Add escalation message to conversation
    const escalationMessage = {
      id: uuidv4(),
      type: 'system',
      content: `Conversation escalated to human agent. Reason: ${reason || 'User requested human assistance'}`,
      timestamp: new Date().toISOString(),
      metadata: {
        type: 'escalation',
        reason: reason || 'User requested human assistance',
        priority: priority,
        escalatedAt: new Date().toISOString()
      }
    };

    await addMessage({
      id: escalationMessage.id,
      sessionId,
      type: 'system',
      content: escalationMessage.content,
      timestamp: escalationMessage.timestamp,
      metadata: escalationMessage.metadata,
    });

    const updatedSession = await escalateConversation({
      sessionId,
      reason: reason || 'User requested human assistance',
      priority,
    });

    logger.info(`Conversation ${sessionId} escalated to human agent:`, reason);

    res.json({
      success: true,
      data: {
        message: 'Conversation escalated successfully',
        escalationMessage,
        conversation: {
          sessionId: updatedSession.session_id,
          escalated: !!updatedSession.escalated,
          escalationReason: updatedSession.escalation_reason,
          escalationPriority: updatedSession.escalation_priority,
          updatedAt: updatedSession.updated_at
        }
      }
    });

  } catch (error) {
    logger.error('Escalation error:', error);
    next(error);
  }
});

/**
 * DELETE /api/chat/session/:sessionId
 * Delete a conversation session
 */
router.delete('/session/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const existing = await executeQuery(
      `SELECT session_id FROM chat_sessions WHERE session_id = ? LIMIT 1`,
      [sessionId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Conversation not found'
      });
    }

    await executeCommand(`DELETE FROM chat_sessions WHERE session_id = ?`, [sessionId]);

    logger.info(`Conversation session ${sessionId} deleted`);

    res.json({
      success: true,
      message: 'Conversation deleted successfully'
    });

  } catch (error) {
    logger.error('Session deletion error:', error);
    next(error);
  }
});

module.exports = router;
