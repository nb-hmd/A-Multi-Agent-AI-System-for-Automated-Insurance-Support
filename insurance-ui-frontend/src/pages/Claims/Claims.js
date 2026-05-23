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
  Report as ReportIcon,
  Person as PersonIcon,
  CalendarToday as CalendarIcon,
  AttachMoney as MoneyIcon,
} from '@mui/icons-material';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import dataService from '../../services/dataService';
import FileClaimWizard from './FileClaimWizard';

const Claims = () => {
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const [claims, setClaims] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fileWizardOpen, setFileWizardOpen] = useState(false);

  useEffect(() => {
    fetchClaims();
  }, [user, page, rowsPerPage]);

  const fetchClaims = async () => {
    try {
      setLoading(true);
      setError(null);

      const customerId = user?.customerId;
      const response = await dataService.getClaims(customerId, {
        limit: rowsPerPage,
        offset: page * rowsPerPage
      });
      
      if (response && response.claims) {
        setClaims(response.claims);
        setTotal(response.pagination?.total ?? response.total ?? response.claims.length);
        showNotification(`Loaded ${response.claims.length} claims from database`, 'success');
      } else {
        setClaims([]);
        setTotal(0);
        showNotification('No claims found', 'info');
      }
    } catch (error) {
      console.error('Error fetching claims:', error);
      setError('Failed to load claims. Please try again.');
      showNotification('Error loading claims', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = async (claim) => {
    try {
      const response = await dataService.getClaimById(claim.claim_id);
      if (response && response.claim) {
        setSelectedClaim(response.claim);
        setDialogOpen(true);
      }
    } catch (error) {
      console.error('Error fetching claim details:', error);
      showNotification('Error loading claim details', 'error');
    }
  };

  const handleClaimSuccess = () => {
    setFileWizardOpen(false);
    fetchClaims();
  };

  const filteredClaims = claims.filter(claim =>
    claim.claim_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    claim.policy_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    claim.incident_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    claim.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'open': return 'warning';
      case 'settled': return 'success';
      case 'denied': return 'error';
      case 'pending': return 'info';
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
            <Button color="inherit" size="small" onClick={fetchClaims}>
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
          Claims Management
        </Typography>
        <Box display="flex" gap={2}>
          <TextField
            placeholder="Search claims..."
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
            onClick={fetchClaims}
            disabled={loading}
          >
            Refresh
          </Button>
          {user?.role === 'customer' && (
            <Button
              variant="contained"
              onClick={() => setFileWizardOpen(true)}
              disabled={loading}
            >
              File New Claim
            </Button>
          )}
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
                    Total Claims
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    {total}
                  </Typography>
                </Box>
                <ReportIcon color="primary" sx={{ fontSize: 40 }} />
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
                    Open Claims
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="warning.main">
                    {claims.filter(c => c.status === 'open').length}
                  </Typography>
                </Box>
                <ReportIcon color="warning" sx={{ fontSize: 40 }} />
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
                    Settled Claims
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="success.main">
                    {claims.filter(c => c.status === 'settled').length}
                  </Typography>
                </Box>
                <ReportIcon color="success" sx={{ fontSize: 40 }} />
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
                    Total Estimated Loss
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="error.main">
                    {formatCurrency(claims.reduce((sum, c) => sum + parseFloat(c.estimated_loss || 0), 0))}
                  </Typography>
                </Box>
                <MoneyIcon color="error" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Claims Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Claim ID</strong></TableCell>
                <TableCell><strong>Policy Number</strong></TableCell>
                <TableCell><strong>Incident Type</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell><strong>Claim Date</strong></TableCell>
                <TableCell><strong>Estimated Loss</strong></TableCell>
                <TableCell><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredClaims.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Box py={4}>
                      <Typography color="text.secondary">
                        {searchTerm ? 'No claims match your search' : 'No claims found'}
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                filteredClaims.map((claim) => (
                  <TableRow key={claim.claim_id} hover>
                    <TableCell>
                      <Typography fontWeight="medium">
                        {claim.claim_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography>
                        {claim.policy_number}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography>
                        {claim.incident_type || 'N/A'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={claim.status} 
                        size="small"
                        color={getStatusColor(claim.status)}
                      />
                    </TableCell>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <CalendarIcon fontSize="small" />
                        <Typography variant="body2">
                          {formatDate(claim.claim_date)}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight="medium">
                        {formatCurrency(claim.estimated_loss)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <IconButton
                        color="primary"
                        onClick={() => handleViewDetails(claim)}
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

      {/* Claim Details Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={() => setDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Claim Details: {selectedClaim?.claim_id}
        </DialogTitle>
        <DialogContent>
          {selectedClaim && (
            <Box>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Claim Information
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText 
                            primary="Claim ID"
                            secondary={selectedClaim.claim_id}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Policy Number"
                            secondary={selectedClaim.policy_number}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Incident Type"
                            secondary={selectedClaim.incident_type || 'N/A'}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Status"
                            secondary={
                              <Chip 
                                label={selectedClaim.status} 
                                size="small"
                                color={getStatusColor(selectedClaim.status)}
                              />
                            }
                            secondaryTypographyProps={{ component: 'div' }}
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
                        Financial Information
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemText 
                            primary="Estimated Loss"
                            secondary={formatCurrency(selectedClaim.estimated_loss)}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemText 
                            primary="Settlement Amount"
                            secondary={formatCurrency(selectedClaim.settlement_amount || 0)}
                          />
                        </ListItem>
                        {selectedClaim.settlement_date && (
                          <ListItem>
                            <ListItemText 
                              primary="Settlement Date"
                              secondary={formatDate(selectedClaim.settlement_date)}
                            />
                          </ListItem>
                        )}
                      </List>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
              
              <Box mt={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Claim Timeline
                    </Typography>
                    <List dense>
                      <ListItem>
                        <ListItemText 
                          primary="Claim Date"
                          secondary={formatDate(selectedClaim.claim_date)}
                        />
                      </ListItem>
                      {selectedClaim.incident_date && (
                        <ListItem>
                          <ListItemText 
                            primary="Incident Date"
                            secondary={formatDate(selectedClaim.incident_date)}
                          />
                        </ListItem>
                      )}
                      {selectedClaim.settlement_date && (
                        <ListItem>
                          <ListItemText 
                            primary="Settlement Date"
                            secondary={formatDate(selectedClaim.settlement_date)}
                          />
                        </ListItem>
                      )}
                    </List>
                  </CardContent>
                </Card>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* File Claim Wizard Dialog */}
      <Dialog
        open={fileWizardOpen}
        onClose={() => setFileWizardOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>File a New Claim</DialogTitle>
        <DialogContent>
          <FileClaimWizard 
            onClose={() => setFileWizardOpen(false)} 
            onSuccess={handleClaimSuccess} 
          />
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default Claims;
