import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, [logout]);

  // Verify token on mount
  useEffect(() => {
    const verifyToken = async () => {
      if (token) {
        try {
          const response = await authService.verifyToken(token);
          setUser(response.data);
        } catch (error) {
          logout();
        }
      }
      setLoading(false);
    };

    verifyToken();
  }, [token, logout]);

  const login = useCallback(async (username, password) => {
    try {
      setError(null);
      setLoading(true);
      
      const response = await authService.login(username, password);
      const { token: newToken, user: userData } = response.data;
      
      localStorage.setItem('token', newToken);
      setToken(newToken);
      setUser(userData);
      
      return { success: true };
    } catch (error) {
      setError(error.message || 'Login failed');
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (userData) => {
    try {
      setError(null);
      setLoading(true);
      
      const response = await authService.register(userData);
      const { token: newToken, user: newUser } = response.data;
      
      localStorage.setItem('token', newToken);
      setToken(newToken);
      setUser(newUser);
      
      return { success: true };
    } catch (error) {
      setError(error.message || 'Registration failed');
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  }, []);

  const updateProfile = useCallback(async (userData) => {
    try {
      setError(null);
      setLoading(true);
      
      const response = await authService.updateProfile(userData);
      setUser(response.data);
      
      return { success: true };
    } catch (error) {
      setError(error.message || 'Profile update failed');
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    try {
      setError(null);
      setLoading(true);
      
      await authService.changePassword(currentPassword, newPassword);
      
      return { success: true };
    } catch (error) {
      setError(error.message || 'Password change failed');
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  }, []);

  // Manual token refresh for debugging
  const refreshToken = useCallback(async (newToken) => {
    try {
      if (newToken) {
        localStorage.setItem('token', newToken);
        setToken(newToken);
        const response = await authService.verifyToken(newToken);
        setUser(response.data);
        return { success: true };
      } else {
        // Clear token if no new token provided
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
        return { success: true };
      }
    } catch (error) {
      localStorage.removeItem('token');
      setToken(null);
      setUser(null);
      return { success: false, error: error.message };
    }
  }, []);

  const value = {
    user,
    token,
    loading,
    error,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    updateProfile,
    changePassword,
    refreshToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
