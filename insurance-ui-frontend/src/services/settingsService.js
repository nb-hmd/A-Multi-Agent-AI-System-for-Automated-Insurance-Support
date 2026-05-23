import api from './api';

const settingsService = {
  async getSettings() {
    const response = await api.get('/settings');
    return response.data.data;
  },

  async updateSettings(partialSettings) {
    const response = await api.put('/settings', partialSettings);
    return response.data.data;
  },
};

export default settingsService;

