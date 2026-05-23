import React, { useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  TextField,
  Button,
  Alert,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  ListItemText,
  Chip,
} from '@mui/material';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import adminService from '../../services/adminService';

const AdminCustomers = () => {
  const { user } = useAuth();
  const { showError, showSuccess } = useNotification();
  const isAdmin = user?.role === 'admin';

  const initial = useMemo(() => ({
    username: '',
    password: '',
    policyTypes: [],
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    state: '',
    address: '',
    city: '',
    zipCode: '',
    dateOfBirth: '',
  }), []);

  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const handleChange = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  };

  const handlePolicyTypesChange = (e) => {
    const value = e.target.value;
    setForm((prev) => ({
      ...prev,
      policyTypes: Array.isArray(value) ? value : [],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSubmitting(true);
    setResult(null);
    try {
      const payload = {
        username: form.username.trim(),
        password: form.password,
        policyTypes: Array.isArray(form.policyTypes) ? form.policyTypes : [],
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        state: form.state.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        zipCode: form.zipCode.trim() || null,
        dateOfBirth: form.dateOfBirth.trim() || null,
      };
      const resp = await adminService.registerCustomer(payload);
      setResult(resp?.data || null);
      showSuccess('Customer account created successfully');
      setForm(initial);
    } catch (err) {
      const msg = err?.message || 'Failed to create customer account';
      showError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAdmin) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Admin access required.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 2 }}>
        Customer Registration
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Create a new customer login and a matching customer record. The customer can sign in using the username and password you provide.
      </Typography>

      <Card>
        <CardContent>
          <Box component="form" onSubmit={handleSubmit}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Login Credentials
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Username"
                  fullWidth
                  required
                  value={form.username}
                  onChange={handleChange('username')}
                  disabled={submitting}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Password"
                  type="password"
                  fullWidth
                  required
                  value={form.password}
                  onChange={handleChange('password')}
                  disabled={submitting}
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>
              Policy Application
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={8}>
                <FormControl fullWidth>
                  <InputLabel id="policy-types-label">Policy Types</InputLabel>
                  <Select
                    labelId="policy-types-label"
                    multiple
                    value={form.policyTypes}
                    onChange={handlePolicyTypesChange}
                    label="Policy Types"
                    disabled={submitting}
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {(selected || []).map((value) => (
                          <Chip key={value} label={value} size="small" />
                        ))}
                      </Box>
                    )}
                  >
                    {['auto', 'home', 'life', 'health'].map((t) => (
                      <MenuItem key={t} value={t}>
                        <Checkbox checked={form.policyTypes.indexOf(t) > -1} />
                        <ListItemText primary={t} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <Alert severity="info">
                  Select one or more policy types the customer is applying for.
                </Alert>
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>
              Customer Profile
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="First Name"
                  fullWidth
                  required
                  value={form.firstName}
                  onChange={handleChange('firstName')}
                  disabled={submitting}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Last Name"
                  fullWidth
                  required
                  value={form.lastName}
                  onChange={handleChange('lastName')}
                  disabled={submitting}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Email"
                  type="email"
                  fullWidth
                  required
                  value={form.email}
                  onChange={handleChange('email')}
                  disabled={submitting}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Phone"
                  fullWidth
                  value={form.phone}
                  onChange={handleChange('phone')}
                  disabled={submitting}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="State"
                  fullWidth
                  value={form.state}
                  onChange={handleChange('state')}
                  disabled={submitting}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="ZIP Code"
                  fullWidth
                  value={form.zipCode}
                  onChange={handleChange('zipCode')}
                  disabled={submitting}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Date of Birth"
                  placeholder="YYYY-MM-DD"
                  fullWidth
                  value={form.dateOfBirth}
                  onChange={handleChange('dateOfBirth')}
                  disabled={submitting}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Address"
                  fullWidth
                  value={form.address}
                  onChange={handleChange('address')}
                  disabled={submitting}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="City"
                  fullWidth
                  value={form.city}
                  onChange={handleChange('city')}
                  disabled={submitting}
                />
              </Grid>
            </Grid>

            <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
              <Button type="submit" variant="contained" disabled={submitting}>
                Create Customer
              </Button>
              <Button
                type="button"
                variant="outlined"
                disabled={submitting}
                onClick={() => {
                  setForm(initial);
                  setResult(null);
                }}
              >
                Reset
              </Button>
            </Box>
          </Box>

          {result?.user?.customerId && (
            <Box sx={{ mt: 3 }}>
              <Alert severity="success">
                Customer created. Customer ID: {result.user.customerId}. Username: {result.user.username}.
              </Alert>
              {Array.isArray(result.policies) && result.policies.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                    Created Policies
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {result.policies.map((p) => (
                      <Chip
                        key={`${p.policyNumber}_${p.policyType}`}
                        label={`${p.policyType.toUpperCase()} • ${p.policyNumber}`}
                        color="primary"
                        variant="outlined"
                        size="small"
                      />
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default AdminCustomers;
