const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');
const { authenticateToken } = require('./auth');
const { getSettings, upsertSettings } = require('../services/settingsStorage');

const router = express.Router();

const updateSchema = Joi.object({
  profile: Joi.object({
    firstName: Joi.string().allow(null, ''),
    lastName: Joi.string().allow(null, ''),
    email: Joi.string().email().allow(null, ''),
    phone: Joi.string().allow(null, ''),
    state: Joi.string().allow(null, ''),
  }).optional(),
  notifications: Joi.object({
    inApp: Joi.boolean(),
    email: Joi.boolean(),
    sms: Joi.boolean(),
  }).optional(),
  chat: Joi.object({
    showTypingIndicator: Joi.boolean(),
    autoScroll: Joi.boolean(),
    maxHistoryMessages: Joi.number().integer().min(10).max(500),
  }).optional(),
  privacy: Joi.object({
    analytics: Joi.boolean(),
    dataCollection: Joi.boolean(),
  }).optional(),
  integrations: Joi.object({
    multiAgentEnabled: Joi.boolean(),
    faqEnabled: Joi.boolean(),
  }).optional(),
  system: Joi.object({
    themeMode: Joi.string().valid('light', 'dark'),
    locale: Joi.string(),
    timeZone: Joi.string().allow(null, ''),
  }).optional(),
}).min(1);

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const customerId = req.user.customerId;
    if (!customerId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Customer ID is required for settings'
      });
    }

    const result = await getSettings(customerId);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Settings fetch error:', error);
    next(error);
  }
});

router.put('/', authenticateToken, async (req, res, next) => {
  try {
    const { error, value } = updateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const customerId = req.user.customerId;
    if (!customerId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Customer ID is required for settings'
      });
    }

    const result = await upsertSettings(customerId, value);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Settings update error:', error);
    next(error);
  }
});

module.exports = router;

