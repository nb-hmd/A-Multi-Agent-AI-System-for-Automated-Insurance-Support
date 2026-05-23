import React, { createContext, useContext, useEffect, useMemo, useCallback, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import { createAppTheme } from '../styles/theme';
import { useAuth } from './AuthContext';
import settingsService from '../services/settingsService';

const SettingsContext = createContext();

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
};

const LOCAL_STORAGE_KEY_PREFIX = 'appSettings:';

const defaultSettings = {
  profile: {
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    state: null,
  },
  notifications: {
    inApp: true,
    email: false,
    sms: false,
  },
  chat: {
    showTypingIndicator: true,
    autoScroll: true,
    maxHistoryMessages: 50,
  },
  privacy: {
    analytics: true,
    dataCollection: false,
  },
  integrations: {
    multiAgentEnabled: true,
    faqEnabled: true,
  },
  system: {
    themeMode: 'light',
    locale: 'en-US',
    timeZone: null,
  },
};

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  const out = { ...(target || {}) };
  Object.keys(source).forEach((key) => {
    const sVal = source[key];
    const tVal = out[key];
    if (sVal && typeof sVal === 'object' && !Array.isArray(sVal)) {
      out[key] = deepMerge(tVal && typeof tVal === 'object' ? tVal : {}, sVal);
    } else {
      out[key] = sVal;
    }
  });
  return out;
}

export const SettingsProvider = ({ children }) => {
  const { user, token } = useAuth();
  const storageKey = useMemo(() => {
    const identity = user?.customerId || user?.username || user?.id || 'anonymous';
    return `${LOCAL_STORAGE_KEY_PREFIX}${identity}`;
  }, [user]);

  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const themeMode = settings?.system?.themeMode || 'light';
  const theme = useMemo(() => createAppTheme(themeMode), [themeMode]);

  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? safeJsonParse(raw) : null;
    const merged = parsed ? deepMerge(defaultSettings, parsed) : defaultSettings;
    setSettings(merged);
  }, [storageKey]);

  const refreshSettings = useCallback(async () => {
    if (!token || !user?.customerId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await settingsService.getSettings();
      const serverSettings = resp?.settings || defaultSettings;
      const merged = deepMerge(defaultSettings, serverSettings);
      setSettings(merged);
      localStorage.setItem(storageKey, JSON.stringify(merged));
    } catch (e) {
      setError(e.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [token, user, storageKey]);

  const updateSettings = useCallback(async (partial) => {
    setLoading(true);
    setError(null);
    try {
      const optimistic = deepMerge(settings, partial);
      setSettings(optimistic);
      localStorage.setItem(storageKey, JSON.stringify(optimistic));

      if (token && user?.customerId) {
        const resp = await settingsService.updateSettings(partial);
        const serverSettings = resp?.settings || optimistic;
        const merged = deepMerge(defaultSettings, serverSettings);
        setSettings(merged);
        localStorage.setItem(storageKey, JSON.stringify(merged));
      }
      return { success: true };
    } catch (e) {
      setError(e.message || 'Failed to update settings');
      return { success: false, error: e.message };
    } finally {
      setLoading(false);
    }
  }, [settings, token, user, storageKey]);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  const value = useMemo(() => ({
    settings,
    loading,
    error,
    themeMode,
    locale: settings?.system?.locale || 'en-US',
    timeZone: settings?.system?.timeZone || undefined,
    refreshSettings,
    updateSettings,
  }), [settings, loading, error, themeMode, refreshSettings, updateSettings]);

  return (
    <SettingsContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </SettingsContext.Provider>
  );
};

