import api from './api';

const adminService = {
  async registerCustomer(payload) {
    const response = await api.post('/auth/admin/register-customer', payload);
    return response.data;
  },
};

export default adminService;
