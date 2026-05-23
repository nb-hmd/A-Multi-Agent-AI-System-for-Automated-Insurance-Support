import api from './api';

export const chatService = {
  async sendMessage(sessionId, message, context = {}, customerId = null, policyNumber = null) {
    try {
      const payload = { sessionId, message, context };
      if (typeof customerId === 'string' && customerId.trim()) payload.customerId = customerId.trim();
      if (typeof policyNumber === 'string' && policyNumber.trim()) payload.policyNumber = policyNumber.trim();
      const response = await api.post('/chat/query', payload);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to send message');
    }
  },

  async getConversationHistory(sessionId, limit = 50, offset = 0) {
    try {
      const response = await api.get(`/chat/history/${sessionId}`, {
        params: { limit, offset },
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch conversation history');
    }
  },

  async getSessions() {
    try {
      const response = await api.get('/chat/sessions');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch sessions');
    }
  },

  async requestEscalation(sessionId, reason, priority = 'medium') {
    try {
      const response = await api.post('/chat/escalate', {
        sessionId,
        reason,
        priority,
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to request escalation');
    }
  },

  async deleteSession(sessionId) {
    try {
      const response = await api.delete(`/chat/session/${sessionId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to delete session');
    }
  },
};
