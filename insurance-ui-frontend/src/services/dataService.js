import api from './api';

const dataService = {
  // Dashboard Analytics
  async getDashboardAnalytics() {
    try {
      const response = await api.get('/analytics/dashboard');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching dashboard analytics:', error);
      throw error;
    }
  },

  // Policies
  async getPolicies(customerId = null, options = {}) {
    try {
      const url = customerId ? `/policy/customer/${customerId}` : '/policy';
      const params = new URLSearchParams();
      Object.entries(options || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        params.set(k, String(v));
      });
      const response = await api.get(params.toString() ? `${url}?${params}` : url);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching policies:', error);
      throw error;
    }
  },

  async getPolicyByNumber(policyNumber) {
    try {
      const response = await api.get(`/policy/${policyNumber}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching policy details:', error);
      throw error;
    }
  },

  async updatePolicyPricing(policyNumber, premiumAmount, billingFrequency) {
    try {
      const response = await api.put(`/policy/${policyNumber}/pricing`, {
        premiumAmount,
        billingFrequency,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error updating policy pricing:', error);
      throw error;
    }
  },

  async generateInvoice(policyNumber, payload = {}) {
    try {
      const response = await api.post(`/billing/policy/${policyNumber}/invoice`, payload);
      return response.data.data;
    } catch (error) {
      console.error('Error generating invoice:', error);
      throw error;
    }
  },

  async payBill(billId, amount, paymentMethod, transactionId = null) {
    try {
      const response = await api.post(`/billing/bill/${billId}/pay`, {
        amount,
        paymentMethod,
        transactionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error making payment:', error);
      throw error;
    }
  },

  async getPolicyStats() {
    const response = await api.get('/policy/stats/overview');
    return response.data.data;
  },

  async getQuote(type, details) {
    const response = await api.post('/policy/quote', { type, details });
    return response.data.data;
  },

  async createPolicy(policyData) {
    const response = await api.post('/policy', policyData);
    return response.data.data;
  },

  // Claims
  async getClaims(customerId = null, options = {}) {
    try {
      const url = customerId ? `/claims/customer/${customerId}` : '/claims';
      const params = new URLSearchParams();
      Object.entries(options || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        params.set(k, String(v));
      });
      const response = await api.get(params.toString() ? `${url}?${params}` : url);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching claims:', error);
      throw error;
    }
  },

  async getClaimById(claimId) {
    try {
      const response = await api.get(`/claims/${claimId}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching claim details:', error);
      throw error;
    }
  },

  async fileClaim(policyNumber, incidentType, estimatedLoss, incidentDate, description, evidenceFiles = []) {
    try {
      const response = await api.post('/claims/file', {
        policyNumber,
        incidentType,
        estimatedLoss,
        incidentDate,
        description,
        evidenceFiles
      });
      return response.data.data;
    } catch (error) {
      console.error('Error filing claim:', error);
      throw error;
    }
  },

  // Billing
  async getBilling(customerId = null, options = {}) {
    try {
      const url = customerId ? `/billing/customer/${customerId}` : '/billing';
      const params = new URLSearchParams();
      Object.entries(options || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        params.set(k, String(v));
      });
      const response = await api.get(params.toString() ? `${url}?${params}` : url);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching billing data:', error);
      throw error;
    }
  },

  async getBillingByPolicy(policyNumber) {
    try {
      const response = await api.get(`/billing/policy/${policyNumber}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching billing by policy:', error);
      throw error;
    }
  },

  // Chat/AI Assistant
  async sendChatMessage(message, sessionId = null, customerId = null) {
    try {
      const response = await api.post('/chat/query', {
        message,
        sessionId,
        customerId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error sending chat message:', error);
      throw error;
    }
  },

  async getChatHistory(sessionId) {
    try {
      const response = await api.get(`/chat/conversation/${sessionId}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching chat history:', error);
      throw error;
    }
  },

  // Customer-specific data
  async getCustomerDashboard(customerId) {
    try {
      const [
        analytics,
        policies,
        claims,
        billing
      ] = await Promise.all([
        this.getDashboardAnalytics(),
        this.getPolicies(customerId),
        this.getClaims(customerId),
        this.getBilling(customerId)
      ]);

      return {
        analytics,
        policies,
        claims,
        billing
      };
    } catch (error) {
      console.error('Error fetching customer dashboard data:', error);
      throw error;
    }
  },

  async getDocuments() {
    try {
      const response = await api.get('/documents');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching documents:', error);
      throw error;
    }
  },

  // Vector database operations (ChromaDB)
  async searchVectorDatabase(query, collection = 'insurance_knowledge') {
    try {
      const response = await api.post('/vector/search', {
        query,
        collection,
        limit: 5
      });
      return response.data.data;
    } catch (error) {
      console.error('Error searching vector database:', error);
      throw error;
    }
  },

  async getVectorCollections() {
    try {
      const response = await api.get('/vector/collections');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching vector collections:', error);
      throw error;
    }
  },

  async getProactiveNotifications(customerId) {
    try {
      const response = await api.get(`/notifications/proactive?customer_id=${customerId}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching proactive notifications:', error);
      return [];
    }
  }
};

export default dataService;
