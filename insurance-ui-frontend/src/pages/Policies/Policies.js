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
  Paper,
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
  Divider,
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
  Policy as PolicyIcon,
  Person as PersonIcon,
  CalendarToday as CalendarIcon,
  AttachMoney as MoneyIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import dataService from '../../services/dataService';
import QuoteWizard from './QuoteWizard';

const Policies = () => {
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const [policies, setPolicies] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pricingDraft, setPricingDraft] = useState({ premiumAmount: '', billingFrequency: 'monthly' });
  const [savingPricing, setSavingPricing] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);

  const canManage = user?.role === 'admin' || user?.role === 'agent';

  useEffect(() => {
    fetchPolicies();
  }, [user, page, rowsPerPage]);

  const fetchPolicies = async () => {
    try {
      setLoading(true);
      setError(null);

      const customerId = user?.customerId;
      const response = await dataService.getPolicies(customerId, {
        limit: rowsPerPage,
        offset: page * rowsPerPage
      });
      
      if (response && response.policies) {
        setPolicies(response.policies);
        setTotal(response.pagination?.total ?? response.total ?? response.policies.length);
        showNotification(`Loaded ${response.policies.length} policies from database`, 'success');
      } else {
        setPolicies([]);
        setTotal(0);
        showNotification('No policies found', 'info');
      }
    } catch (error) {
      console.error('Error fetching policies:', error);
      setError('Failed to load policies. Please try again.');
      showNotification('Error loading policies', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = async (policy) => {
    try {
      const response = await dataService.getPolicyByNumber(policy.policy_number);
      if (response && response.policy) {
        setSelectedPolicy(response.policy);
        setPricingDraft({
          premiumAmount: response.policy.premium_amount ?? '',
          billingFrequency: response.policy.billing_frequency || 'monthly',
        });
        setDialogOpen(true);
      }
    } catch (error) {
      console.error('Error fetching policy details:', error);
      showNotification('Error loading policy details', 'error');
    }
  };

  const handleSavePricing = async () => {
    if (!selectedPolicy || !canManage) return;
    setSavingPricing(true);
    try {
      const premiumAmount = Number(pricingDraft.premiumAmount);
      const billingFrequency = pricingDraft.billingFrequency;
      const resp = await dataService.updatePolicyPricing(selectedPolicy.policy_number, premiumAmount, billingFrequency);
      if (resp?.policy) {
        setSelectedPolicy((prev) => ({ ...prev, ...resp.policy }));
      }
      showNotification('Policy pricing updated', 'success');
      fetchPolicies();
    } catch (error) {
      showNotification('Failed to update policy pricing', 'error');
    } finally {
      setSavingPricing(false);
    }
  };

  const handleGenerateInvoice = async () => {
    if (!selectedPolicy || !canManage) return;
    setGeneratingInvoice(true);
    try {
      const resp = await dataService.generateInvoice(selectedPolicy.policy_number, {});
      if (resp?.billing?.bill_id) {
        showNotification(`Invoice generated: ${resp.billing.bill_id}`, 'success');
      } else {
        showNotification('Invoice generated', 'success');
      }
    } catch (error) {
      showNotification('Failed to generate invoice', 'error');
    } finally {
      setGeneratingInvoice(false);
    }
  };

  const filteredPolicies = policies.filter(policy =>
    policy.policy_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    policy.policy_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
    policy.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    policy.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    policy.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'active': return 'success';
      case 'expired': return 'warning';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
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
            <Button color="inherit" size="small" onClick={fetchPolicies}>
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
          Policies Management
        </Typography>
        <Box display="flex" gap={2}>
          <TextField
            placeholder="Search policies..."
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
            onClick={fetchPolicies}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setQuoteOpen(true)}
          >
            Get a Quote
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
                    Total Policies
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    {total}
                  </Typography>
                </Box>
                <PolicyIcon color="primary" sx={{ fontSize: 40 }} />
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
                    Active Policies
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="success.main">
                    {policies.filter(p => p.status === 'active').length}
                  </Typography>
                </Box>
                <PolicyIcon color="success" sx={{ fontSize: 40 }} />
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
                    Total Premium
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="warning.main">
                    {formatCurrency(policies.reduce((sum, p) => sum + parseFloat(p.premium_amount || 0), 0))}
                  </Typography>
                </Box>
                <MoneyIcon color="warning" sx={{ fontSize: 40 }} />
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
                    Expired Policies
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="error.main">
                    {policies.filter(p => p.status === 'expired').length}
                  </Typography>
                </Box>
                <PolicyIcon color="error" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Policies Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Policy Number</strong></TableCell>
                <TableCell><strong>Customer</strong></TableCell>
                <TableCell><strong>Type</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell><strong>Premium</strong></TableCell>
                <TableCell><strong>Start Date</strong></TableCell>
                <TableCell><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredPolicies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Box py={4}>
                      <Typography color="text.secondary">
                        {searchTerm ? 'No policies match your search' : 'No policies found'}
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                filteredPolicies.map((policy) => (
                  <TableRow key={policy.policy_number} hover>
                    <TableCell>
                      <Typography fontWeight="medium">
                        {policy.policy_number}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <PersonIcon fontSize="small" />
                        <Typography>
                          {policy.first_name} {policy.last_name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={policy.policy_type} 
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={policy.status} 
                        size="small"
                        color={getStatusColor(policy.status)}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight="medium">
                        {formatCurrency(policy.premium_amount)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <CalendarIcon fontSize="small" />
                        <Typography variant="body2">
                          {formatDate(policy.start_date)}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <IconButton
                        color="primary"
                        onClick={() => handleViewDetails(policy)}
                        title="View Details"
                      >
                        <ViewIcon />
                      </IconButton>
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

      {/* Quote Wizard Dialog */}
      <Dialog
        open={quoteOpen}
        onClose={() => setQuoteOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Get a Quote</DialogTitle>
        <DialogContent>
          <QuoteWizard 
            onClose={() => setQuoteOpen(false)}
            onSuccess={() => {
              setQuoteOpen(false);
              fetchPolicies();
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Policy Details Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={() => setDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Policy Details: {selectedPolicy?.policy_number}
        </DialogTitle>
        <DialogContent>
          {selectedPolicy && (
            <Box>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Policy Information
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText 
                            primary="Policy Number"
                            secondary={selectedPolicy.policy_number}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Policy Type"
                            secondary={selectedPolicy.policy_type}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Status"
                            secondary={
                              <Chip 
                                label={selectedPolicy.status} 
                                size="small"
                                color={getStatusColor(selectedPolicy.status)}
                              />
                            }
                            secondaryTypographyProps={{ component: 'div' }}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Premium Amount"
                            secondary={
                              canManage ? (
                                <TextField
                                  type="number"
                                  size="small"
                                  value={pricingDraft.premiumAmount}
                                  onChange={(e) => setPricingDraft((p) => ({ ...p, premiumAmount: e.target.value }))}
                                  inputProps={{ min: 0, step: '0.01' }}
                                />
                              ) : (
                                formatCurrency(selectedPolicy.premium_amount)
                              )
                            }
                            secondaryTypographyProps={canManage ? { component: 'div' } : undefined}
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
                        Customer Information
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText 
                            primary="Customer Name"
                            secondary={`${selectedPolicy.first_name} ${selectedPolicy.last_name}`}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Email"
                            secondary={selectedPolicy.email}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Phone"
                            secondary={selectedPolicy.phone}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="State"
                            secondary={selectedPolicy.state}
                          />
                        </ListItem>
                      </List>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
              
              <Box mt={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Policy Timeline
                    </Typography>
                    <List dense>
                      <ListItem>
                        <ListItemText 
                          primary="Start Date"
                          secondary={formatDate(selectedPolicy.start_date)}
                        />
                      </ListItem>
                      {selectedPolicy.end_date && (
                        <ListItem>
                          <ListItemText 
                            primary="End Date"
                            secondary={formatDate(selectedPolicy.end_date)}
                          />
                        </ListItem>
                      )}
                      <ListItem>
                        <ListItemText 
                          primary="Billing Frequency"
                          secondary={
                            canManage ? (
                              <FormControl size="small" sx={{ minWidth: 160 }}>
                                <InputLabel id="billing-frequency-label">Frequency</InputLabel>
                                <Select
                                  labelId="billing-frequency-label"
                                  value={pricingDraft.billingFrequency}
                                  label="Frequency"
                                  onChange={(e) => setPricingDraft((p) => ({ ...p, billingFrequency: e.target.value }))}
                                >
                                  <MenuItem value="monthly">monthly</MenuItem>
                                  <MenuItem value="quarterly">quarterly</MenuItem>
                                  <MenuItem value="annual">annual</MenuItem>
                                </Select>
                              </FormControl>
                            ) : (
                              selectedPolicy.billing_frequency
                            )
                          }
                          secondaryTypographyProps={canManage ? { component: 'div' } : undefined}
                        />
                      </ListItem>
                    </List>
                  </CardContent>
                </Card>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {canManage && (
            <>
              <Button variant="outlined" onClick={handleGenerateInvoice} disabled={generatingInvoice}>
                Generate Invoice
              </Button>
              <Button variant="contained" onClick={handleSavePricing} disabled={savingPricing}>
                Save Pricing
              </Button>
            </>
          )}
          <Button onClick={() => setDialogOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Policies;
