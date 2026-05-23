import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Button,
  Alert,
  CircularProgress,
  LinearProgress,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  People as PeopleIcon,
  AttachMoney as MoneyIcon,
  Report as ReportIcon,
  Chat as ChatIcon,
} from '@mui/icons-material';
import { LineChart } from '@mui/x-charts/LineChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import dataService from '../../services/dataService';

const Analytics = () => {
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [claims, setClaims] = useState([]);
  const [billing, setBilling] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchAnalyticsData();
  }, [user]);

  const fetchAnalyticsData = async () => {
    try {
      setLoading(true);
      setError(null);

      const customerId = user?.customerId;
      const [
        analyticsData,
        policiesData,
        claimsData,
        billingData
      ] = await Promise.all([
        dataService.getDashboardAnalytics(),
        dataService.getPolicies(customerId),
        dataService.getClaims(customerId),
        dataService.getBilling(customerId)
      ]);

      setAnalytics(analyticsData);
      setPolicies(policiesData?.policies || []);
      setClaims(claimsData?.claims || []);
      setBilling(billingData?.billing || []);

      showNotification('Analytics data loaded successfully', 'success');
    } catch (error) {
      console.error('Error fetching analytics data:', error);
      setError('Failed to load analytics data. Please try again.');
      showNotification('Error loading analytics data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount || 0);
  };

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'active':
      case 'paid':
      case 'settled':
        return 'success';
      case 'pending':
      case 'open':
        return 'warning';
      case 'expired':
      case 'cancelled':
      case 'denied':
      case 'overdue':
        return 'error';
      default:
        return 'default';
    }
  };

  // Calculate real analytics from data
  const totalPolicies = policies.length;
  const activePolicies = policies.filter(p => p.status === 'active').length;
  const totalPremium = policies.reduce((sum, p) => sum + (parseFloat(p.premium_amount) || 0), 0);

  const totalClaims = claims.length;
  const openClaims = claims.filter(c => c.status === 'open').length;
  const settledClaims = claims.filter(c => c.status === 'settled').length;
  const totalClaimValue = claims.reduce((sum, c) => sum + (parseFloat(c.estimated_loss) || 0), 0);

  const totalBills = billing.length;
  const pendingBills = billing.filter(b => b.status === 'pending').length;
  const paidBills = billing.filter(b => b.status === 'paid').length;
  const totalAmountDue = billing.reduce((sum, b) => sum + (parseFloat(b.amount_due) || 0), 0);

  // Policy type distribution
  const policyTypeDistribution = policies.reduce((acc, policy) => {
    const type = policy.policy_type;
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const pieChartData = Object.entries(policyTypeDistribution).map(([type, count]) => ({
    label: type.charAt(0).toUpperCase() + type.slice(1),
    value: count,
  }));

  // Claims status distribution
  const claimsStatusDistribution = claims.reduce((acc, claim) => {
    const status = claim.status;
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const barChartData = Object.entries(claimsStatusDistribution).map(([status, count]) => ({
    status: status.charAt(0).toUpperCase() + status.slice(1),
    count,
  }));

  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const lastNMonths = (n) => {
    const months = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d);
    }
    return months;
  };

  const safeDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const trendBuckets = lastNMonths(6).reduce((acc, d) => {
    acc[monthKey(d)] = { month: d.toLocaleString('en-US', { month: 'short' }), policies: 0, claims: 0, billing: 0 };
    return acc;
  }, {});

  policies.forEach((p) => {
    const d = safeDate(p.start_date);
    if (!d) return;
    const key = monthKey(new Date(d.getFullYear(), d.getMonth(), 1));
    if (trendBuckets[key]) trendBuckets[key].policies += 1;
  });

  claims.forEach((c) => {
    const d = safeDate(c.claim_date);
    if (!d) return;
    const key = monthKey(new Date(d.getFullYear(), d.getMonth(), 1));
    if (trendBuckets[key]) trendBuckets[key].claims += 1;
  });

  billing.forEach((b) => {
    const d = safeDate(b.billing_date || b.due_date);
    if (!d) return;
    const key = monthKey(new Date(d.getFullYear(), d.getMonth(), 1));
    if (trendBuckets[key]) trendBuckets[key].billing += 1;
  });

  const trendData = Object.keys(trendBuckets).sort().map((k) => trendBuckets[k]);

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
            <Button color="inherit" size="small" onClick={fetchAnalyticsData}>
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
          Analytics Dashboard
        </Typography>
        <Button 
          variant="outlined" 
          onClick={fetchAnalyticsData}
          disabled={loading}
        >
          Refresh Data
        </Button>
      </Box>

      {/* Key Metrics */}
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
                    {totalPolicies}
                  </Typography>
                </Box>
                <PeopleIcon color="primary" sx={{ fontSize: 40 }} />
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
                    {activePolicies}
                  </Typography>
                </Box>
                <PeopleIcon color="success" sx={{ fontSize: 40 }} />
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
                    {formatCurrency(totalPremium)}
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
                    Open Claims
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="error.main">
                    {openClaims}
                  </Typography>
                </Box>
                <ReportIcon color="error" sx={{ fontSize: 40 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Charts Section */}
      <Grid container spacing={3} mb={4}>
        {/* Policy Type Distribution */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Policy Type Distribution
              </Typography>
              {pieChartData.length > 0 ? (
                <PieChart
                  series={[
                    {
                      data: pieChartData,
                      innerRadius: 60,
                      outerRadius: 120,
                    },
                  ]}
                  height={300}
                  margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                />
              ) : (
                <Box display="flex" justifyContent="center" alignItems="center" height={300}>
                  <Typography color="text.secondary">No policy data available</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Claims Status Distribution */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Claims Status Distribution
              </Typography>
              {barChartData.length > 0 ? (
                <BarChart
                  xAxis={[{ scaleType: 'band', data: barChartData.map(d => d.status) }]}
                  series={[{ data: barChartData.map(d => d.count), label: 'Claims' }]}
                  height={300}
                  margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                />
              ) : (
                <Box display="flex" justifyContent="center" alignItems="center" height={300}>
                  <Typography color="text.secondary">No claims data available</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Detailed Statistics */}
      <Grid container spacing={3}>
        {/* Claims Summary */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Claims Summary
              </Typography>
              <Box mt={2}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Total Claims:</Typography>
                  <Typography variant="body2" fontWeight="bold">{totalClaims}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Open Claims:</Typography>
                  <Typography variant="body2" fontWeight="bold" color="warning.main">{openClaims}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Settled Claims:</Typography>
                  <Typography variant="body2" fontWeight="bold" color="success.main">{settledClaims}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Total Estimated Loss:</Typography>
                  <Typography variant="body2" fontWeight="bold" color="error.main">{formatCurrency(totalClaimValue)}</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={totalClaims > 0 ? (settledClaims / totalClaims) * 100 : 0}
                  sx={{ mt: 2, height: 8, borderRadius: 4 }}
                />
                <Typography variant="caption" color="text.secondary">
                  Settlement Rate: {totalClaims > 0 ? ((settledClaims / totalClaims) * 100).toFixed(1) : 0}%
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Billing Summary */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Billing Summary
              </Typography>
              <Box mt={2}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Total Bills:</Typography>
                  <Typography variant="body2" fontWeight="bold">{totalBills}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Pending Bills:</Typography>
                  <Typography variant="body2" fontWeight="bold" color="warning.main">{pendingBills}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Paid Bills:</Typography>
                  <Typography variant="body2" fontWeight="bold" color="success.main">{paidBills}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Total Amount Due:</Typography>
                  <Typography variant="body2" fontWeight="bold" color="error.main">{formatCurrency(totalAmountDue)}</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={totalBills > 0 ? (paidBills / totalBills) * 100 : 0}
                  sx={{ mt: 2, height: 8, borderRadius: 4 }}
                />
                <Typography variant="caption" color="text.secondary">
                  Payment Rate: {totalBills > 0 ? ((paidBills / totalBills) * 100).toFixed(1) : 0}%
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Policy Performance */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Policy Performance
              </Typography>
              <Box mt={2}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Total Policies:</Typography>
                  <Typography variant="body2" fontWeight="bold">{totalPolicies}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Active Policies:</Typography>
                  <Typography variant="body2" fontWeight="bold" color="success.main">{activePolicies}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Total Premium:</Typography>
                  <Typography variant="body2" fontWeight="bold" color="primary.main">{formatCurrency(totalPremium)}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Avg Premium:</Typography>
                  <Typography variant="body2" fontWeight="bold">{formatCurrency(totalPolicies > 0 ? totalPremium / totalPolicies : 0)}</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={totalPolicies > 0 ? (activePolicies / totalPolicies) * 100 : 0}
                  sx={{ mt: 2, height: 8, borderRadius: 4 }}
                />
                <Typography variant="caption" color="text.secondary">
                  Activation Rate: {totalPolicies > 0 ? ((activePolicies / totalPolicies) * 100).toFixed(1) : 0}%
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Analytics;
