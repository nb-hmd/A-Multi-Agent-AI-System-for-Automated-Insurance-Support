const logger = require('../utils/logger');

/**
 * Socket.IO event handlers for real-time communication
 */
function setupSocketHandlers(io) {
  logger.info('Setting up Socket.IO handlers...');

  // Connection handler
  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id}`);

    // Join conversation room
    socket.on('join-conversation', (data) => {
      const { sessionId, userId } = data;
      
      if (sessionId) {
        socket.join(`conversation-${sessionId}`);
        logger.info(`Client ${socket.id} joined conversation room: conversation-${sessionId}`);
        
        // Notify other users in the room
        socket.to(`conversation-${sessionId}`).emit('user-joined', {
          userId,
          socketId: socket.id,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Leave conversation room
    socket.on('leave-conversation', (data) => {
      const { sessionId, userId } = data;
      
      if (sessionId) {
        socket.leave(`conversation-${sessionId}`);
        logger.info(`Client ${socket.id} left conversation room: conversation-${sessionId}`);
        
        // Notify other users in the room
        socket.to(`conversation-${sessionId}`).emit('user-left', {
          userId,
          socketId: socket.id,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Chat message handler
    socket.on('chat-message', (data) => {
      const { sessionId, message, userId, messageType = 'text' } = data;
      
      logger.info(`Chat message from ${socket.id} in session ${sessionId}:`, message);

      // Broadcast message to all users in the conversation room
      socket.to(`conversation-${sessionId}`).emit('chat-message', {
        message,
        userId,
        messageType,
        timestamp: new Date().toISOString(),
        socketId: socket.id
      });

      // Send confirmation back to sender
      socket.emit('message-sent', {
        messageId: data.messageId || Date.now().toString(),
        timestamp: new Date().toISOString(),
        status: 'delivered'
      });
    });

    // Typing indicator
    socket.on('typing-start', (data) => {
      const { sessionId, userId, isTyping = true } = data;
      
      logger.debug(`Typing indicator from ${socket.id} in session ${sessionId}`);
      
      socket.to(`conversation-${sessionId}`).emit('typing-indicator', {
        userId,
        isTyping,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('typing-stop', (data) => {
      const { sessionId, userId } = data;
      
      socket.to(`conversation-${sessionId}`).emit('typing-indicator', {
        userId,
        isTyping: false,
        timestamp: new Date().toISOString()
      });
    });

    // Agent status updates
    socket.on('agent-status', (data) => {
      const { sessionId, agentType, status, message } = data;
      
      logger.info(`Agent status update for ${agentType} in session ${sessionId}: ${status}`);
      
      socket.to(`conversation-${sessionId}`).emit('agent-status-update', {
        agentType,
        status,
        message,
        timestamp: new Date().toISOString()
      });
    });

    // Escalation events
    socket.on('escalation-request', (data) => {
      const { sessionId, reason, priority = 'medium' } = data;
      
      logger.info(`Escalation request in session ${sessionId}: ${reason}`);
      
      // Broadcast to all users in the conversation
      socket.to(`conversation-${sessionId}`).emit('escalation-initiated', {
        sessionId,
        reason,
        priority,
        timestamp: new Date().toISOString(),
        escalatedBy: socket.id
      });

      // Also notify admin room
      socket.to('admin-room').emit('new-escalation', {
        sessionId,
        reason,
        priority,
        timestamp: new Date().toISOString(),
        escalatedBy: socket.id
      });
    });

    // Connection status events
    socket.on('connection-status', (data) => {
      const { status, sessionId } = data;
      
      logger.debug(`Connection status for ${socket.id}: ${status}`);
      
      if (sessionId) {
        socket.to(`conversation-${sessionId}`).emit('connection-status-update', {
          socketId: socket.id,
          status,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Admin events
    socket.on('join-admin-room', (data) => {
      const { userId, role } = data;
      
      if (role === 'admin' || role === 'agent') {
        socket.join('admin-room');
        logger.info(`Admin user ${userId} joined admin room`);
        
        socket.emit('admin-room-joined', {
          message: 'Joined admin room successfully',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Error handling
    socket.on('error', (error) => {
      logger.error(`Socket error for ${socket.id}:`, error);
    });

    // Disconnect handler
    socket.on('disconnect', (reason) => {
      logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
      
      // Notify other users in conversations that this user left
      const rooms = Array.from(socket.rooms);
      rooms.forEach(room => {
        if (room !== socket.id) {
          socket.to(room).emit('user-disconnected', {
            socketId: socket.id,
            timestamp: new Date().toISOString()
          });
        }
      });
    });

    // Custom event for system notifications
    socket.on('system-notification', (data) => {
      const { type, message, severity = 'info', targetUsers = [] } = data;
      
      logger.info(`System notification: ${type} - ${message}`);
      
      if (targetUsers.length > 0) {
        // Send to specific users
        targetUsers.forEach(userId => {
          socket.to(`user-${userId}`).emit('system-notification', {
            type,
            message,
            severity,
            timestamp: new Date().toISOString()
          });
        });
      } else {
        // Broadcast to all connected clients
        io.emit('system-notification', {
          type,
          message,
          severity,
          timestamp: new Date().toISOString()
        });
      }
    });
  });

  // System-wide events
  io.on('error', (error) => {
    logger.error('Socket.IO server error:', error);
  });

  // Health check function
  function getConnectionStats() {
    const connectedSockets = Array.from(io.sockets.sockets.values());
    const roomStats = {};
    
    connectedSockets.forEach(socket => {
      const rooms = Array.from(socket.rooms);
      rooms.forEach(room => {
        if (room !== socket.id) {
          roomStats[room] = (roomStats[room] || 0) + 1;
        }
      });
    });

    return {
      totalConnections: connectedSockets.length,
      roomStats,
      timestamp: new Date().toISOString()
    };
  }

  // Expose stats function
  return {
    getConnectionStats,
    
    // Utility function to send system notifications
    sendSystemNotification: (type, message, severity = 'info', targetUsers = []) => {
      if (targetUsers.length > 0) {
        targetUsers.forEach(userId => {
          io.to(`user-${userId}`).emit('system-notification', {
            type,
            message,
            severity,
            timestamp: new Date().toISOString()
          });
        });
      } else {
        io.emit('system-notification', {
          type,
          message,
          severity,
          timestamp: new Date().toISOString()
        });
      }
    },

    // Utility function to send agent status updates
    sendAgentStatusUpdate: (sessionId, agentType, status, message = '') => {
      io.to(`conversation-${sessionId}`).emit('agent-status-update', {
        agentType,
        status,
        message,
        timestamp: new Date().toISOString()
      });
    }
  };
}

module.exports = { setupSocketHandlers };
