const express = require('express');
const Joi = require('joi');
const authService = require('../services/authService');
const logger = require('../utils/logger');
const { getSettings, upsertSettings } = require('../services/settingsStorage');

const router = express.Router();

/**
 * Validation schemas
 */
const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});

const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  role: Joi.string().valid('customer', 'agent', 'admin').default('customer')
});

const adminCreateCustomerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(6).required(),
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  policyTypes: Joi.array().items(Joi.string().valid('auto', 'home', 'life', 'health')).default([]),
  phone: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  city: Joi.string().allow('', null),
  state: Joi.string().allow('', null),
  zipCode: Joi.string().allow('', null),
  dateOfBirth: Joi.string().allow('', null),
});

/**
 * POST /api/auth/login
 * Authenticate user and return JWT token
 */
router.post('/login', async (req, res, next) => {
  try {
    // Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const { username, password } = value;

    // Authenticate user
    const result = await authService.login(username, password);

    // Update last login
    await authService.updateLastLogin(result.user.id);

    res.json({
      success: true,
      message: 'Login successful',
      data: result
    });

  } catch (error) {
    logger.error('Login error:', error);
    next(error);
  }
});

/**
 * POST /api/auth/register
 * Register new user
 */
router.post('/register', async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Access token required'
      });
    }
    const currentUser = await authService.verifyToken(token);
    if (currentUser.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    // Validate input
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    // Register user
    const user = await authService.register(value);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: user
    });

  } catch (error) {
    logger.error('Registration error:', error);
    next(error);
  }
});

router.post('/admin/register-customer', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    const { error, value } = adminCreateCustomerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const normalized = {
      ...value,
      phone: value.phone ? String(value.phone).trim() : null,
      address: value.address ? String(value.address).trim() : null,
      city: value.city ? String(value.city).trim() : null,
      state: value.state ? String(value.state).trim() : null,
      zipCode: value.zipCode ? String(value.zipCode).trim() : null,
      dateOfBirth: value.dateOfBirth ? String(value.dateOfBirth).trim() : null,
      policyTypes: Array.isArray(value.policyTypes) ? value.policyTypes : [],
    };

    const result = await authService.createCustomerAccount(normalized);

    res.status(201).json({
      success: true,
      message: 'Customer registered successfully',
      data: result
    });
  } catch (error) {
    logger.error('Admin customer registration error:', error);
    next(error);
  }
});

/**
 * GET /api/auth/profile
 * Get current user profile (requires authentication)
 */
router.get('/profile', authenticateToken, async (req, res, next) => {
  try {
    const user = await authService.getUserById(req.user.id);
    const customerId = user.customerId;
    const settings = customerId ? await getSettings(customerId) : null;
    const merged = settings?.settings?.profile
      ? { ...user, ...normalizeProfile(settings.settings.profile) }
      : user;
    
    res.json({
      success: true,
      data: merged
    });

  } catch (error) {
    logger.error('Profile fetch error:', error);
    next(error);
  }
});

router.put('/profile', authenticateToken, async (req, res, next) => {
  try {
    const schema = Joi.object({
      firstName: Joi.string().allow('', null),
      lastName: Joi.string().allow('', null),
      email: Joi.string().email().allow('', null),
      phone: Joi.string().allow('', null),
      state: Joi.string().allow('', null),
    }).min(1);

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const current = await authService.getUserById(req.user.id);
    if (!current.customerId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Customer profile updates require a customer account'
      });
    }

    await upsertSettings(current.customerId, { profile: value });
    await authService.updateUserProfile(req.user.id, value);

    const updated = await authService.getUserById(req.user.id);
    const settings = await getSettings(updated.customerId);
    const merged = settings?.settings?.profile
      ? { ...updated, ...normalizeProfile(settings.settings.profile) }
      : updated;

    res.json({
      success: true,
      data: merged
    });
  } catch (error) {
    logger.error('Profile update error:', error);
    next(error);
  }
});

/**
 * PUT /api/auth/change-password
 * Change user password (requires authentication)
 */
router.put('/change-password', authenticateToken, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Current password and new password are required'
      });
    }

    await authService.changePassword(req.user.id, currentPassword, newPassword);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Password change error:', error);
    next(error);
  }
});

/**
 * POST /api/auth/verify-token
 * Verify JWT token validity
 */
router.post('/verify-token', async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Token is required'
      });
    }

    const user = await authService.verifyToken(token);

    res.json({
      success: true,
      data: user
    });

  } catch (error) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }
});

/**
 * Middleware to authenticate JWT token
 */
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Access token required'
      });
    }

    const user = await authService.verifyToken(token);
    req.user = user;
    next();

  } catch (error) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }
}

function normalizeProfile(profile) {
  const out = {};
  if (!profile) return out;
  if (profile.firstName != null && profile.firstName !== '') out.firstName = profile.firstName;
  if (profile.lastName != null && profile.lastName !== '') out.lastName = profile.lastName;
  if (profile.email != null && profile.email !== '') out.email = profile.email;
  if (profile.phone != null && profile.phone !== '') out.phone = profile.phone;
  if (profile.state != null && profile.state !== '') out.state = profile.state;
  return out;
}

module.exports = { router, authenticateToken };
