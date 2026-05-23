import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  TextField,
  Button,
  FormControlLabel,
  Switch,
  Divider,
  MenuItem,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
} from '@mui/material';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

const Settings = () => {
  const { settings, loading, error, updateSettings } = useSettings();
  const { user, updateProfile, changePassword } = useAuth();
  const { showSuccess, showError } = useNotification();

  const [tab, setTab] = useState(0);

  const [profile, setProfile] = useState(settings.profile);
  const [notifications, setNotifications] = useState(settings.notifications);
  const [chat, setChat] = useState(settings.chat);
  const [privacy, setPrivacy] = useState(settings.privacy);
  const [integrations, setIntegrations] = useState(settings.integrations);
  const [system, setSystem] = useState(settings.system);

  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProfile(settings.profile);
    setNotifications(settings.notifications);
    setChat(settings.chat);
    setPrivacy(settings.privacy);
    setIntegrations(settings.integrations);
    setSystem(settings.system);
  }, [settings]);

  const localeOptions = useMemo(() => ([
    { value: 'en-US', label: 'English (United States)' },
    { value: 'en-GB', label: 'English (United Kingdom)' },
    { value: 'es-ES', label: 'Español (España)' },
    { value: 'fr-FR', label: 'Français (France)' },
    { value: 'de-DE', label: 'Deutsch (Deutschland)' },
    { value: 'it-IT', label: 'Italiano (Italia)' },
  ]), []);

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const profileResult = user?.customerId ? await updateProfile(profile) : { success: true };
      if (!profileResult.success) {
        showError(profileResult.error || 'Profile update failed');
        return;
      }

      const result = await updateSettings({
        notifications,
        chat,
        privacy,
        integrations,
        system,
      });

      if (!result.success) {
        showError(result.error || 'Failed to save settings');
        return;
      }

      showSuccess('Settings saved');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      showError('Please enter current and new password');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showError('New password and confirmation do not match');
      return;
    }
    setSaving(true);
    try {
      const result = await changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      if (result.success) {
        showSuccess('Password changed');
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        showError(result.error || 'Password change failed');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Settings
      </Typography>

      <Box sx={{ mt: 2 }}>
        <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
          <Tab label="Profile" />
          <Tab label="Notifications" />
          <Tab label="Chat" />
          <Tab label="Privacy & Security" />
          <Tab label="Integrations" />
          <Tab label="System" />
        </Tabs>
      </Box>

      {(error || (user && !user.customerId)) && (
        <Alert severity={user && !user.customerId ? 'warning' : 'error'} sx={{ mt: 2 }}>
          {user && !user.customerId
            ? 'Some settings are only available for customer accounts.'
            : error}
        </Alert>
      )}

      <Box sx={{ mt: 2 }}>
        {(loading || saving) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              {saving ? 'Saving...' : 'Loading...'}
            </Typography>
          </Box>
        )}

        {tab === 0 && (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>User Profile</Typography>
              <Divider sx={{ mb: 2 }} />
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="First Name"
                    value={profile.firstName || ''}
                    onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Last Name"
                    value={profile.lastName || ''}
                    onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Email"
                    value={profile.email || ''}
                    onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Phone"
                    value={profile.phone || ''}
                    onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="State"
                    value={profile.state || ''}
                    onChange={(e) => setProfile((p) => ({ ...p, state: e.target.value }))}
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        {tab === 1 && (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Notification Preferences</Typography>
              <Divider sx={{ mb: 2 }} />
              <FormControlLabel
                control={<Switch checked={!!notifications.inApp} onChange={(e) => setNotifications((n) => ({ ...n, inApp: e.target.checked }))} />}
                label="In-app notifications"
              />
              <FormControlLabel
                control={<Switch checked={!!notifications.email} onChange={(e) => setNotifications((n) => ({ ...n, email: e.target.checked }))} />}
                label="Email notifications"
              />
              <FormControlLabel
                control={<Switch checked={!!notifications.sms} onChange={(e) => setNotifications((n) => ({ ...n, sms: e.target.checked }))} />}
                label="SMS notifications"
              />
            </CardContent>
          </Card>
        )}

        {tab === 2 && (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Chat Settings</Typography>
              <Divider sx={{ mb: 2 }} />
              <FormControlLabel
                control={<Switch checked={!!chat.showTypingIndicator} onChange={(e) => setChat((c) => ({ ...c, showTypingIndicator: e.target.checked }))} />}
                label="Show typing indicator"
              />
              <FormControlLabel
                control={<Switch checked={!!chat.autoScroll} onChange={(e) => setChat((c) => ({ ...c, autoScroll: e.target.checked }))} />}
                label="Auto-scroll to latest messages"
              />
              <Box sx={{ mt: 2, maxWidth: 320 }}>
                <TextField
                  fullWidth
                  type="number"
                  label="Max history messages"
                  value={chat.maxHistoryMessages}
                  onChange={(e) => setChat((c) => ({ ...c, maxHistoryMessages: Number(e.target.value) }))}
                />
              </Box>
            </CardContent>
          </Card>
        )}

        {tab === 3 && (
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Privacy</Typography>
                  <Divider sx={{ mb: 2 }} />
                  <FormControlLabel
                    control={<Switch checked={!!privacy.analytics} onChange={(e) => setPrivacy((p) => ({ ...p, analytics: e.target.checked }))} />}
                    label="Allow analytics"
                  />
                  <FormControlLabel
                    control={<Switch checked={!!privacy.dataCollection} onChange={(e) => setPrivacy((p) => ({ ...p, dataCollection: e.target.checked }))} />}
                    label="Allow data collection"
                  />
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Security</Typography>
                  <Divider sx={{ mb: 2 }} />
                  <TextField
                    fullWidth
                    type="password"
                    label="Current Password"
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm((s) => ({ ...s, currentPassword: e.target.value }))}
                    sx={{ mb: 2 }}
                  />
                  <TextField
                    fullWidth
                    type="password"
                    label="New Password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm((s) => ({ ...s, newPassword: e.target.value }))}
                    sx={{ mb: 2 }}
                  />
                  <TextField
                    fullWidth
                    type="password"
                    label="Confirm New Password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm((s) => ({ ...s, confirmPassword: e.target.value }))}
                    sx={{ mb: 2 }}
                  />
                  <Button variant="outlined" onClick={handleChangePassword} disabled={saving}>
                    Change Password
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {tab === 4 && (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Integrations</Typography>
              <Divider sx={{ mb: 2 }} />
              <FormControlLabel
                control={<Switch checked={!!integrations.multiAgentEnabled} onChange={(e) => setIntegrations((i) => ({ ...i, multiAgentEnabled: e.target.checked }))} />}
                label="Enable multi-agent processing"
              />
              <FormControlLabel
                control={<Switch checked={!!integrations.faqEnabled} onChange={(e) => setIntegrations((i) => ({ ...i, faqEnabled: e.target.checked }))} />}
                label="Enable FAQ answers (insuranceQA-v2)"
              />
            </CardContent>
          </Card>
        )}

        {tab === 5 && (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>System Preferences</Typography>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 420 }}>
                <TextField
                  select
                  label="Theme"
                  value={system.themeMode || 'light'}
                  onChange={(e) => setSystem((s) => ({ ...s, themeMode: e.target.value }))}
                >
                  <MenuItem value="light">Light</MenuItem>
                  <MenuItem value="dark">Dark</MenuItem>
                </TextField>
                <TextField
                  select
                  label="Language / Locale"
                  value={system.locale || 'en-US'}
                  onChange={(e) => setSystem((s) => ({ ...s, locale: e.target.value }))}
                >
                  {localeOptions.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Time Zone (optional)"
                  value={system.timeZone || ''}
                  onChange={(e) => setSystem((s) => ({ ...s, timeZone: e.target.value }))}
                  placeholder="e.g. America/New_York"
                />
              </Box>
            </CardContent>
          </Card>
        )}

        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={handleSaveAll} disabled={saving || loading}>
            Save Changes
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default Settings;
