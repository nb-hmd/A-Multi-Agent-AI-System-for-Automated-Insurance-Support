import React, { useState, useEffect } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  LinearProgress,
  Chip,
  Avatar,
  Button,
  Alert,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  People as PeopleIcon,
  AttachMoney as AttachMoneyIcon,
  Report as ReportIcon,
  Chat as ChatIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { LineChart } from '@mui/x-charts/LineChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import dataService from '../../services/dataService';

const Dashboard = () => {
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [policies, setPolicies] = useState(null);
  const [claims, setClaims] = useState(null);
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchRealData();
  }, [user]);

  const fetchRealData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch all dashboard data
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
      setPolicies(policiesData);
      setClaims(claimsData);
      setBilling(billingData);

      showNotification(`Welcome back, ${user?.firstName}! Loaded real data from database.`, 'success');
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setError('Failed to load dashboard data. Please try again.');
      showNotification('Error loading dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    await fetchRealData();
  };

  const StatCard = ({ title, value, subtitle, icon, color = 'primary', trend, loading }) => (
    <Card sx={{ height: '100%', borderRadius: 3, boxShadow: 3 }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Avatar sx={{ bgcolor: `${color}.main`, width: 56, height: 56 }}>
            {icon}
          </Avatar>
          {trend && (
            <Chip
              icon={<TrendingUpIcon />}
              label={`+${trend}%`}
              color="success"
              size="small"
            />
          )}
        </Box>
        <Typography variant="h4" component="div" fontWeight="bold" color={`${color}.main`}>
          {loading ? <LinearProgress /> : value}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <Box textAlign="center">
          <Typography variant="h6" gutterBottom>
            Loading real data from database...
          </Typography>
          <LinearProgress sx={{ width: '300px', mt: 2 }} />
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <Alert 
          severity="error" 
          action={
            <Button color="inherit" size="small" onClick={refreshData}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  const isCustomerView = !!user?.customerId;

  // Calculate real statistics from data
  const totalPolicies = isCustomerView ? (policies?.policies?.length || 0) : (analytics?.policies?.total || 0);
  const activePolicies = isCustomerView
    ? (policies?.policies?.filter(p => p.status === 'active')?.length || 0)
    : (analytics?.policies?.active || 0);
  const totalPremium = isCustomerView
    ? (policies?.policies?.reduce((sum, p) => sum + (parseFloat(p.premium_amount) || 0), 0) || 0)
    : parseFloat(analytics?.policies?.totalActivePremium || 0);
  
  const totalClaims = isCustomerView ? (claims?.claims?.length || 0) : (analytics?.claims?.total || 0);
  const openClaims = isCustomerView
    ? (claims?.claims?.filter(c => c.status === 'open')?.length || 0)
    : (analytics?.claims?.open || 0);
  const settledClaims = isCustomerView
    ? (claims?.claims?.filter(c => c.status === 'settled')?.length || 0)
    : (analytics?.claims?.settled || 0);
  const totalClaimValue = isCustomerView
    ? (claims?.claims?.reduce((sum, c) => sum + (parseFloat(c.estimated_loss) || 0), 0) || 0)
    : parseFloat(analytics?.claims?.totalEstimatedLoss || 0);

  const totalBills = isCustomerView ? (billing?.billing?.length || 0) : (analytics?.billing?.total || 0);
  const pendingBills = isCustomerView
    ? (billing?.billing?.filter(b => b.status === 'pending')?.length || 0)
    : (analytics?.billing?.pending || 0);
  const paidBills = isCustomerView
    ? (billing?.billing?.filter(b => b.status === 'paid')?.length || 0)
    : (analytics?.billing?.paid || 0);
  const totalAmountDue = isCustomerView
    ? (billing?.billing?.reduce((sum, b) => sum + (parseFloat(b.amount_due) || 0), 0) || 0)
    : parseFloat(analytics?.billing?.totalAmountDue || 0);

  // Real conversation data from analytics
  const totalConversations = analytics?.conversations?.totalConversations || 0;
  const activeConversations = analytics?.conversations?.activeConversations || 0;
  const escalatedConversations = analytics?.conversations?.escalatedConversations || 0;
  const avgResponseTime = analytics?.conversations?.avgResponseTime || '0s';

  // Recent activity calculation
  const recentActivity = isCustomerView ? {
    policies: policies?.policies?.filter(p => {
      const startDate = new Date(p.start_date);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return startDate >= thirtyDaysAgo;
    })?.length || 0,
    claims: claims?.claims?.filter(c => {
      const claimDate = new Date(c.claim_date);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return claimDate >= thirtyDaysAgo;
    })?.length || 0,
    billing: billing?.billing?.filter(b => {
      const billingDate = new Date(b.billing_date);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return billingDate >= thirtyDaysAgo;
    })?.length || 0
  } : (analytics?.recentActivity || { policies: 0, claims: 0, billing: 0 });

  return (
    <Box>
      {/* Welcome Section */}
      <Box mb={4} display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h4" fontWeight="bold" gutterBottom>
            Welcome back, {user?.firstName}!
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Here's your real insurance data from the database.
          </Typography>
        </Box>
        <Button 
          variant="outlined" 
          onClick={refreshData}
          disabled={loading}
        >
          Refresh Data
        </Button>
      </Box>

      {/* Key Metrics - Real Data */}
      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Policies"
            value={totalPolicies.toLocaleString()}
            subtitle={`${activePolicies} active, ${totalPolicies - activePolicies} inactive`}
            icon={<PeopleIcon />}
            color="success"
            trend={recentActivity.policies}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Premium"
            value={`$${(totalPremium / 1000).toFixed(0)}K`}
            subtitle={`${activePolicies} active policies`}
            icon={<AttachMoneyIcon />}
            color="warning"
            trend={5.2}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Open Claims"
            value={openClaims.toLocaleString()}
            subtitle={`${settledClaims} settled, ${totalClaims} total`}
            icon={<ReportIcon />}
            color="error"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Amount Due"
            value={`$${(totalAmountDue / 1000).toFixed(0)}K`}
            subtitle={`${pendingBills} pending, ${paidBills} paid bills`}
            icon={<AttachMoneyIcon />}
            color="primary"
          />
        </Grid>
      </Grid>

      {/* Recent Activity Summary */}
      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} md={6}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Recent Activity (Last 30 Days)
              </Typography>
              <Box display="flex" justifyContent="space-between" mt={2}>
                <Box textAlign="center">
                  <Typography variant="h4" color="primary">
                    {recentActivity.policies}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    New Policies
                  </Typography>
                </Box>
                <Box textAlign="center">
                  <Typography variant="h4" color="error">
                    {recentActivity.claims}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    New Claims
                  </Typography>
                </Box>
                <Box textAlign="center">
                  <Typography variant="h4" color="warning">
                    {recentActivity.billing}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    New Bills
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                AI Assistant Performance
              </Typography>
              <Box mt={2}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Total Conversations</Typography>
                  <Typography variant="body2" fontWeight="bold">{totalConversations.toLocaleString()}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Active Conversations</Typography>
                  <Typography variant="body2" fontWeight="bold">{activeConversations.toLocaleString()}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Escalations</Typography>
                  <Typography variant="body2" fontWeight="bold">{escalatedConversations.toLocaleString()}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between">
                  <Typography variant="body2">Avg Response Time</Typography>
                  <Typography variant="body2" fontWeight="bold">{avgResponseTime}</Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Quick Actions */}
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                Quick Actions
              </Typography>
              <Box display="flex" gap={2} flexWrap="wrap" mt={2}>
                <Button
                  variant="contained"
                  startIcon={<ChatIcon />}
                  onClick={() => window.location.href = '/chat'}
                >
                  Start AI Chat
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<PeopleIcon />}
                  onClick={() => window.location.href = '/policies'}
                >
                  View Policies
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<ReportIcon />}
                  onClick={() => window.location.href = '/claims'}
                >
                  View Claims
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<AttachMoneyIcon />}
                  onClick={() => window.location.href = '/billing'}
                >
                  View Billing
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
