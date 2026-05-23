import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  TextField,
  InputAdornment,
  IconButton,
  Alert,
  CircularProgress,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TablePagination,
} from '@mui/material';
import {
  Search as SearchIcon,
  Visibility as ViewIcon,
  Refresh as RefreshIcon,
  Receipt as ReceiptIcon,
  CalendarToday as CalendarIcon,
  AttachMoney as MoneyIcon,
} from '@mui/icons-material';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import dataService from '../../services/dataService';

const Billing = () => {
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const [billing, setBilling] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBill, setSelectedBill] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payDraft, setPayDraft] = useState({ billId: null, amount: '', paymentMethod: 'card', cardNumber: '', expiry: '', cvv: '' });

  useEffect(() => {
    fetchBilling();
  }, [user, page, rowsPerPage]);

  const fetchBilling = async () => {
    try {
      setLoading(true);
      setError(null);

      const customerId = user?.customerId;
      const response = await dataService.getBilling(customerId, {
        limit: rowsPerPage,
        offset: page * rowsPerPage
      });
      
      if (response && response.billing) {
        setBilling(response.billing);
        setTotal(response.pagination?.total ?? response.billing.length);
        showNotification(`Loaded ${response.billing.length} billing records from database`, 'success');
      } else {
        setBilling([]);
        setTotal(0);
        showNotification('No billing records found', 'info');
      }
    } catch (error) {
      console.error('Error fetching billing:', error);
      setError('Failed to load billing records. Please try again.');
      showNotification('Error loading billing records', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = async (bill) => {
    try {
      const response = await dataService.getBillingByPolicy(bill.policy_number);
      if (response && response.billing) {
        setSelectedBill(response.billing);
        setDialogOpen(true);
      }
    } catch (error) {
      console.error('Error fetching billing details:', error);
      showNotification('Error loading billing details', 'error');
    }
  };

  const openPay = (bill) => {
    setPayDraft({
      billId: bill.bill_id,
      amount: Number(bill.amount_due || 0),
      paymentMethod: 'card',
      cardNumber: '',
      expiry: '',
      cvv: ''
    });
    setPayDialogOpen(true);
  };

  const handlePay = async () => {
    if (!payDraft.billId) return;
    
    // Basic validation for demo purposes
    if (payDraft.paymentMethod === 'card') {
      if (!payDraft.cardNumber || !payDraft.expiry || !payDraft.cvv) {
        showNotification('Please fill in all card details', 'error');
        return;
      }
    }

    setPaySubmitting(true);
    try {
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await dataService.payBill(payDraft.billId, Number(payDraft.amount), payDraft.paymentMethod);
      showNotification('Payment processed successfully!', 'success');
      setPayDialogOpen(false);
      setSelectedBill(null);
      setDialogOpen(false);
      fetchBilling();
    } catch (error) {
      showNotification('Payment failed. Please try again.', 'error');
    } finally {
      setPaySubmitting(false);
    }
  };

  const filteredBilling = billing.filter(bill =>
    bill.bill_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bill.policy_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bill.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'paid': return 'success';
      case 'pending': return 'warning';
      case 'overdue': return 'error';
      default: return 'default';
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount || 0);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress size={60} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <Alert 
          severity="error" 
          action={
            <Button color="inherit" size="small" onClick={fetchBilling}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight="bold">
          Billing Management
        </Typography>
        <Box display="flex" gap={2}>
          <TextField
            placeholder="Search billing records..."
            variant="outlined"
            size="small"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 300 }}
          />
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={fetchBilling}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Statistics Cards */}
      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Total Bills
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    {total}
                  </Typography>
                </Box>
                <ReceiptIcon color="primary" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Pending Bills
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="warning.main">
                    {billing.filter(b => b.status === 'pending').length}
                  </Typography>
                </Box>
                <ReceiptIcon color="warning" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Paid Bills
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="success.main">
                    {billing.filter(b => b.status === 'paid').length}
                  </Typography>
                </Box>
                <ReceiptIcon color="success" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Total Amount Due
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="error.main">
                    {formatCurrency(billing.reduce((sum, b) => sum + parseFloat(b.amount_due || 0), 0))}
                  </Typography>
                </Box>
                <MoneyIcon color="error" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Billing Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Bill ID</strong></TableCell>
                <TableCell><strong>Policy Number</strong></TableCell>
                <TableCell><strong>Amount Due</strong></TableCell>
                <TableCell><strong>Due Date</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredBilling.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Box py={4}>
                      <Typography color="text.secondary">
                        {searchTerm ? 'No billing records match your search' : 'No billing records found'}
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                filteredBilling.map((bill) => (
                  <TableRow key={bill.bill_id} hover>
                    <TableCell>
                      <Typography fontWeight="medium">
                        {bill.bill_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography>
                        {bill.policy_number}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight="medium">
                        {formatCurrency(bill.amount_due)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <CalendarIcon fontSize="small" />
                        <Typography variant="body2">
                          {formatDate(bill.due_date)}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={bill.status} 
                        size="small"
                        color={getStatusColor(bill.status)}
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <IconButton
                          color="primary"
                          onClick={() => handleViewDetails(bill)}
                          title="View Details"
                        >
                          <ViewIcon />
                        </IconButton>
                        {user?.role === 'customer' && String(bill.status || '').toLowerCase() !== 'paid' && (
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => openPay(bill)}
                          >
                            Pay
                          </Button>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(e, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[20, 50, 100, 200]}
        />
      </Card>

      {/* Bill Details Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={() => setDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Billing Details: {selectedBill?.bill_id}
        </DialogTitle>
        <DialogContent>
          {selectedBill && (
            <Box>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Bill Information
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText 
                            primary="Bill ID"
                            secondary={selectedBill.bill_id}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Policy Number"
                            secondary={selectedBill.policy_number}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Status"
                            secondary={
                              <Chip 
                                label={selectedBill.status} 
                                size="small"
                                color={getStatusColor(selectedBill.status)}
                              />
                            }
                            secondaryTypographyProps={{ component: 'div' }}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Amount Due"
                            secondary={formatCurrency(selectedBill.amount_due)}
                          />
                        </ListItem>
                      </List>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Payment Information
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText 
                            primary="Billing Date"
                            secondary={formatDate(selectedBill.billing_date)}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Due Date"
                            secondary={formatDate(selectedBill.due_date)}
                          />
                        </ListItem>
                        {selectedBill.payment_date && (
                          <ListItem>
                            <ListItemText 
                              primary="Payment Date"
                              secondary={formatDate(selectedBill.payment_date)}
                            />
                          </ListItem>
                        )}
                      </List>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={payDialogOpen}
        onClose={() => setPayDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Make Payment</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary">
                Bill ID: {payDraft.billId || '—'}
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Amount"
                type="number"
                fullWidth
                value={payDraft.amount}
                onChange={(e) => setPayDraft((p) => ({ ...p, amount: e.target.value }))}
                inputProps={{ min: 0, step: '0.01' }}
                disabled={paySubmitting}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth disabled={paySubmitting}>
                <InputLabel id="payment-method-label">Payment Method</InputLabel>
                <Select
                  labelId="payment-method-label"
                  value={payDraft.paymentMethod}
                  label="Payment Method"
                  onChange={(e) => setPayDraft((p) => ({ ...p, paymentMethod: e.target.value }))}
                >
                  <MenuItem value="card">Credit Card</MenuItem>
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {payDraft.paymentMethod === 'card' && (
              <>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ mb: 1, mt: 1 }}>Card Details</Typography>
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    label="Card Number"
                    fullWidth
                    placeholder="0000 0000 0000 0000"
                    value={payDraft.cardNumber}
                    onChange={(e) => setPayDraft((p) => ({ ...p, cardNumber: e.target.value }))}
                    disabled={paySubmitting}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Expiry Date"
                    fullWidth
                    placeholder="MM/YY"
                    value={payDraft.expiry}
                    onChange={(e) => setPayDraft((p) => ({ ...p, expiry: e.target.value }))}
                    disabled={paySubmitting}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="CVV"
                    fullWidth
                    type="password"
                    placeholder="123"
                    value={payDraft.cvv}
                    onChange={(e) => setPayDraft((p) => ({ ...p, cvv: e.target.value }))}
                    disabled={paySubmitting}
                  />
                </Grid>
              </>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayDialogOpen(false)} disabled={paySubmitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handlePay} disabled={paySubmitting}>
            Pay Now
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Billing;
