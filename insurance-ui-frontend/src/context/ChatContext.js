import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { chatService } from '../services/chatService';
import { socketService } from '../services/socketService';
import { useSettings } from './SettingsContext';

const ChatContext = createContext();

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};

export const ChatProvider = ({ children }) => {
  const { settings } = useSettings();
  const [conversations, setConversations] = useState(new Map());
  const [sessions, setSessions] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const makeId = useCallback(() => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch {}
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }, []);

  // Initialize socket connection
  useEffect(() => {
    const initializeSocket = () => {
      socketService.connect();
      
      socketService.on('connect', () => {
        setIsConnected(true);
        console.log('Socket connected');
      });

      socketService.on('disconnect', () => {
        setIsConnected(false);
        console.log('Socket disconnected');
      });

      socketService.on('chat-message', (data) => {
        handleIncomingMessage(data);
      });

      socketService.on('typing-indicator', (data) => {
        handleTypingIndicator(data);
      });

      socketService.on('agent-status-update', (data) => {
        handleAgentStatusUpdate(data);
      });

      socketService.on('escalation-initiated', (data) => {
        handleEscalation(data);
      });
    };

    initializeSocket();

    return () => {
      socketService.disconnect();
    };
  }, []);

  const handleIncomingMessage = useCallback((data) => {
    const { sessionId, message, userId, messageType, timestamp, metadata } = data;
    
    setConversations(prev => {
      const newConversations = new Map(prev);
      const conversation = newConversations.get(sessionId);
      
      if (conversation) {
        const existing = Array.isArray(conversation.messages) ? conversation.messages : [];
        const incoming = {
          id: makeId(),
          type: 'agent',
          content: message,
          timestamp,
          userId,
          messageType,
          metadata,
        };
        const nextMessages = [...existing, incoming];
        const max = Number(settings?.chat?.maxHistoryMessages || 50);
        const trimmed = nextMessages.length > max ? nextMessages.slice(-max) : nextMessages;
        newConversations.set(sessionId, { ...conversation, messages: trimmed, lastMessage: timestamp });
      }
      
      return newConversations;
    });
  }, [makeId, settings]);

  const handleTypingIndicator = useCallback((data) => {
    const { userId, isTyping } = data;
    
    setTypingUsers(prev => {
      const newSet = new Set(prev);
      if (isTyping) {
        newSet.add(userId);
      } else {
        newSet.delete(userId);
      }
      return newSet;
    });
  }, []);

  const handleAgentStatusUpdate = useCallback((data) => {
    const { agentType, status, message } = data;
    console.log(`Agent ${agentType} status: ${status}`, message);
  }, []);

  const handleEscalation = useCallback((data) => {
    const { sessionId, reason, priority } = data;
    console.log(`Escalation initiated for session ${sessionId}:`, reason, priority);
    
    // Add escalation message to conversation
    setConversations(prev => {
      const newConversations = new Map(prev);
      const conversation = newConversations.get(sessionId);
      
      if (conversation) {
        const existing = Array.isArray(conversation.messages) ? conversation.messages : [];
        const escalation = {
          id: makeId(),
          type: 'system',
          content: `Conversation escalated to human agent. Reason: ${reason}`,
          timestamp: new Date().toISOString(),
          metadata: {
            type: 'escalation',
            reason,
            priority,
          },
        };
        const nextMessages = [...existing, escalation];
        const max = Number(settings?.chat?.maxHistoryMessages || 50);
        const trimmed = nextMessages.length > max ? nextMessages.slice(-max) : nextMessages;
        newConversations.set(sessionId, { ...conversation, messages: trimmed, lastMessage: escalation.timestamp });
      }
      
      return newConversations;
    });
  }, [makeId, settings]);

  const addSystemMessage = useCallback((sessionId, content, metadata = {}) => {
    setConversations(prev => {
      const newConversations = new Map(prev);
      const conversation = newConversations.get(sessionId);
      
      if (conversation) {
        const existing = Array.isArray(conversation.messages) ? conversation.messages : [];
        const systemMsg = {
          id: makeId(),
          type: 'system',
          content,
          timestamp: new Date().toISOString(),
          metadata: { ...metadata, type: 'system' },
        };
        const nextMessages = [...existing, systemMsg];
        const max = Number(settings?.chat?.maxHistoryMessages || 50);
        const trimmed = nextMessages.length > max ? nextMessages.slice(-max) : nextMessages;
        newConversations.set(sessionId, { ...conversation, messages: trimmed, lastMessage: systemMsg.timestamp });
      }
      
      return newConversations;
    });
  }, [makeId, settings]);

  const sendMessage = useCallback(async (sessionId, message, context = {}) => {
    try {
      setError(null);
      setLoading(true);

      if (settings?.integrations?.multiAgentEnabled === false) {
        throw new Error('Chat assistant is disabled in Settings');
      }

      const conversationForContext = conversations.get(sessionId);
      const customerId = conversationForContext?.customerId || null;
      const policyNumber = conversationForContext?.policyNumber || null;

      // Add user message to conversation
      const userMessage = {
        id: makeId(),
        type: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      };

      setConversations(prev => {
        const newConversations = new Map(prev);
        const conversation = newConversations.get(sessionId) || {
          sessionId,
          messages: [],
          createdAt: new Date().toISOString(),
        };
        
        const existing = Array.isArray(conversation.messages) ? conversation.messages : [];
        const hasAlready = existing.some((m) => m?.id === userMessage.id);
        const nextMessages = hasAlready ? existing : [...existing, userMessage];
        const max = Number(settings?.chat?.maxHistoryMessages || 50);
        const trimmed = nextMessages.length > max ? nextMessages.slice(-max) : nextMessages;
        newConversations.set(sessionId, { ...conversation, messages: trimmed, lastMessage: userMessage.timestamp });
        
        return newConversations;
      });

      // Send message via API
      const response = await chatService.sendMessage(sessionId, message, context, customerId, policyNumber);
      
      // Refresh session list to update titles if this was the first message
      fetchSessions();

      // Add agent response to conversation
      if (response.data.agentMessage) {
        setConversations(prev => {
          const newConversations = new Map(prev);
          const conversation = newConversations.get(sessionId);
          
          if (conversation) {
            const existing = Array.isArray(conversation.messages) ? conversation.messages : [];
            const incoming = response.data.agentMessage;
            const hasAlready = existing.some((m) => m?.id && incoming?.id && m.id === incoming.id);
            const nextMessages = hasAlready ? existing : [...existing, incoming];
            const max = Number(settings?.chat?.maxHistoryMessages || 50);
            const trimmed = nextMessages.length > max ? nextMessages.slice(-max) : nextMessages;
            newConversations.set(sessionId, { ...conversation, messages: trimmed, lastMessage: incoming.timestamp });
          }
          
          return newConversations;
        });
      }

      return { success: true, data: response.data };
    } catch (error) {
      setError(error.message || 'Failed to send message');
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  }, [settings, conversations, makeId]);

  const startTyping = useCallback((sessionId) => {
    socketService.emit('typing-start', { sessionId, userId: 'current-user' });
  }, []);

  const stopTyping = useCallback((sessionId) => {
    socketService.emit('typing-stop', { sessionId, userId: 'current-user' });
  }, []);

  const requestEscalation = useCallback(async (sessionId, reason, priority = 'medium') => {
    try {
      socketService.emit('escalation-request', { sessionId, reason, priority });
      
      const response = await chatService.requestEscalation(sessionId, reason, priority);
      return { success: true, data: response.data };
    } catch (error) {
      setError(error.message || 'Failed to request escalation');
      return { success: false, error: error.message };
    }
  }, []);

  const joinConversation = useCallback((sessionId, userId) => {
    socketService.emit('join-conversation', { sessionId, userId });
    setActiveConversation(sessionId);
  }, []);

  const leaveConversation = useCallback((sessionId, userId) => {
    socketService.emit('leave-conversation', { sessionId, userId });
    if (activeConversation === sessionId) {
      setActiveConversation(null);
    }
  }, [activeConversation]);

  const createConversation = useCallback((customerId, policyNumber) => {
    const sessionId = `session_${makeId()}`;
    const conversation = {
      sessionId,
      customerId,
      policyNumber,
      messages: [],
      createdAt: new Date().toISOString(),
      lastMessage: null,
    };
    
    setConversations(prev => new Map(prev).set(sessionId, conversation));
    return sessionId;
  }, [makeId]);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await chatService.getSessions();
      if (response.success) {
        setSessions(response.data.sessions);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    }
  }, []);

  const loadConversation = useCallback(async (sessionId) => {
    try {
      setLoading(true);
      const response = await chatService.getConversationHistory(sessionId);
      if (response.success) {
        setConversations(prev => {
          const newMap = new Map(prev);
          newMap.set(sessionId, {
            sessionId,
            messages: response.data.messages,
            lastMessage: response.data.updatedAt,
            customerId: response.data.customerId,
            policyNumber: response.data.policyNumber,
          });
          return newMap;
        });
        setActiveConversation(sessionId);
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteChatSession = useCallback(async (sessionId) => {
    try {
      await chatService.deleteSession(sessionId);
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
      if (activeConversation === sessionId) {
        setActiveConversation(null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }, [activeConversation]);

  const value = {
    conversations,
    sessions,
    fetchSessions,
    loadConversation,
    deleteChatSession,
    activeConversation,
    isTyping,
    typingUsers,
    loading,
    error,
    isConnected,
    sendMessage,
    addSystemMessage,
    startTyping,
    stopTyping,
    requestEscalation,
    joinConversation,
    leaveConversation,
    createConversation,
    setActiveConversation,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};
