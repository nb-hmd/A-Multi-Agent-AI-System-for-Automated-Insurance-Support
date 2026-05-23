const { executeQuery, executeCommand } = require('../config/realDatabase');

async function initializeChatStorage() {
  await executeCommand(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id TEXT PRIMARY KEY,
      customer_id TEXT,
      policy_number TEXT,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      escalated INTEGER NOT NULL DEFAULT 0,
      escalation_reason TEXT,
      escalation_priority TEXT
    )
  `);

  // Migration: Add title column if it doesn't exist
  try {
    await executeCommand(`ALTER TABLE chat_sessions ADD COLUMN title TEXT`);
  } catch (e) {
    // Column likely exists, ignore
  }

  await executeCommand(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      agent_type TEXT,
      status TEXT,
      next_agent TEXT,
      metadata_json TEXT,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
    )
  `);

  await executeCommand(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_customer_id ON chat_sessions(customer_id)`);
  await executeCommand(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at)`);
  await executeCommand(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id)`);
  await executeCommand(`CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp)`);
  await executeCommand(`CREATE INDEX IF NOT EXISTS idx_chat_messages_agent_type ON chat_messages(agent_type)`);
}

async function ensureSession({ sessionId, customerId = null, policyNumber = null, title = null }) {
  const now = new Date().toISOString();

  const existing = await executeQuery(
    `SELECT session_id, title FROM chat_sessions WHERE session_id = ? LIMIT 1`,
    [sessionId]
  );

  if (existing.length === 0) {
    await executeCommand(
      `INSERT INTO chat_sessions (session_id, customer_id, policy_number, title, created_at, updated_at, escalated)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [sessionId, customerId, policyNumber, title || 'New Chat', now, now]
    );
  } else {
    const updates = [];
    const params = [];
    
    if (customerId) {
      updates.push('customer_id = ?');
      params.push(customerId);
    }
    if (policyNumber) {
      updates.push('policy_number = ?');
      params.push(policyNumber);
    }
    
    // Only update title if explicitly provided and different
    if (title && title !== 'New Chat') {
      // Check if current title is 'New Chat' or null, OR if we want to overwrite it regardless (for now, let's assume we want to update it if it's "New Chat")
      // Actually, if we pass a specific title, we probably want to set it.
      // But we should avoid overwriting a custom title with 'New Chat' if that ever happens.
      // In this case, we only update if the existing title is 'New Chat' or null
      const currentTitle = existing[0].title;
      if (!currentTitle || currentTitle === 'New Chat') {
         updates.push('title = ?');
         params.push(title);
      }
    }
    
    updates.push('updated_at = ?');
    params.push(now);
    params.push(sessionId);

    await executeCommand(
      `UPDATE chat_sessions
       SET ${updates.join(', ')}
       WHERE session_id = ?`,
      params
    );
  }

  const row = await executeQuery(
    `SELECT session_id, customer_id, policy_number, title, created_at, updated_at, escalated, escalation_reason, escalation_priority
     FROM chat_sessions
     WHERE session_id = ?`,
    [sessionId]
  );

  return row[0];
}

async function updateSessionTitle({ sessionId, title }) {
  const now = new Date().toISOString();
  await executeCommand(
    `UPDATE chat_sessions
     SET title = ?,
         updated_at = ?
     WHERE session_id = ?`,
    [title, now, sessionId]
  );
  
  return { sessionId, title, updatedAt: now };
}

async function addMessage({
  id,
  sessionId,
  type,
  content,
  timestamp,
  agentType = null,
  status = null,
  nextAgent = null,
  metadata = null,
}) {
  await executeCommand(
    `INSERT INTO chat_messages (id, session_id, type, content, timestamp, agent_type, status, next_agent, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sessionId,
      type,
      content,
      timestamp,
      agentType,
      status,
      nextAgent,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  await executeCommand(
    `UPDATE chat_sessions SET updated_at = ? WHERE session_id = ?`,
    [timestamp, sessionId]
  );
}

async function getConversation({ sessionId, limit = 50, offset = 0 }) {
  const sessionRows = await executeQuery(
    `SELECT session_id, customer_id, policy_number, created_at, updated_at, escalated, escalation_reason, escalation_priority
     FROM chat_sessions
     WHERE session_id = ?`,
    [sessionId]
  );

  if (sessionRows.length === 0) {
    return null;
  }

  const messages = await executeQuery(
    `SELECT id, type, content, timestamp,
            agent_type as agentType,
            status,
            next_agent as nextAgent,
            metadata_json as metadataJson
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY timestamp ASC
     LIMIT ? OFFSET ?`,
    [sessionId, limit, offset]
  );

  const mappedMessages = messages.map((m) => ({
    id: m.id,
    type: m.type,
    content: m.content,
    timestamp: m.timestamp,
    metadata: m.metadataJson ? safeJsonParse(m.metadataJson) : undefined,
    agentType: m.agentType || undefined,
    status: m.status || undefined,
    nextAgent: m.nextAgent || undefined,
  }));

  return {
    session: sessionRows[0],
    messages: mappedMessages,
    totalMessages: await getMessageCount(sessionId),
  };
}

async function getMessageCount(sessionId) {
  const rows = await executeQuery(
    `SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?`,
    [sessionId]
  );
  return rows[0]?.count || 0;
}

async function listSessions({ customerId = null, limit = 50, offset = 0 } = {}) {
  const params = [];
  let whereClause = "WHERE datetime(updated_at) > datetime('now', '-15 days')";

  if (customerId) {
    whereClause += ' AND customer_id = ?';
    params.push(customerId);
  }

  params.push(limit, offset);

  const rows = await executeQuery(
    `SELECT session_id as sessionId,
            customer_id as customerId,
            policy_number as policyNumber,
            title,
            created_at as createdAt,
            updated_at as updatedAt,
            escalated,
            escalation_reason as escalationReason,
            escalation_priority as escalationPriority,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = chat_sessions.session_id) as messageCount
     FROM chat_sessions
     ${whereClause}
     ORDER BY updated_at DESC
     LIMIT ? OFFSET ?`,
    params
  );

  return rows.map((r) => ({
    sessionId: r.sessionId,
    customerId: r.customerId,
    policyNumber: r.policyNumber,
    title: r.title || 'New Chat',
    messageCount: r.messageCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    escalated: !!r.escalated,
    escalationReason: r.escalationReason,
    escalationPriority: r.escalationPriority,
  }));
}

async function deleteOldSessions() {
  const result = await executeCommand(
    `DELETE FROM chat_sessions WHERE datetime(updated_at) < datetime('now', '-15 days')`
  );
  return result.changes;
}

async function escalateConversation({ sessionId, reason = null, priority = 'medium' }) {
  const now = new Date().toISOString();
  await executeCommand(
    `UPDATE chat_sessions
     SET escalated = 1,
         escalation_reason = ?,
         escalation_priority = ?,
         updated_at = ?
     WHERE session_id = ?`,
    [reason, priority, now, sessionId]
  );

  const rows = await executeQuery(
    `SELECT session_id, customer_id, policy_number, created_at, updated_at, escalated, escalation_reason, escalation_priority
     FROM chat_sessions
     WHERE session_id = ?`,
    [sessionId]
  );

  return rows[0] || null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

module.exports = {
  initializeChatStorage,
  ensureSession,
  addMessage,
  getConversation,
  listSessions,
  escalateConversation,
  deleteOldSessions,
  updateSessionTitle,
};

