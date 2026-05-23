const express = require('express');
const logger = require('../utils/logger');
const multiAgentService = require('../services/realMultiAgentIntegration');
const { authenticateToken } = require('./auth');

const router = express.Router();

/**
 * GET /api/notifications/proactive
 * Get proactive notifications for the current user
 */
router.get('/proactive', authenticateToken, async (req, res, next) => {
  try {
    const customerId = req.user.customerId;
    const notifications = await multiAgentService.getProactiveNotifications(customerId);
    
    res.json({
      success: true,
      data: notifications
    });
  } catch (error) {
    logger.error('Error fetching proactive notifications:', error);
    next(error);
  }
});

module.exports = router;