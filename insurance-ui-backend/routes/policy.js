const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');
const { executeQuery, executeCommand } = require('../config/realDatabase');
const { authenticateToken } = require('./auth');

const router = express.Router();

/**
 * POST /api/policies/quote
 * Calculate estimated premium based on policy details
 */
router.post('/quote', authenticateToken, async (req, res, next) => {
  try {
    const { type, details } = req.body;
    let premium = 1000; // Base premium

    if (type === 'auto') {
      const { vehicleYear, vehicleMake, coverageType } = details;
      if (['BMW', 'Mercedes', 'Audi', 'Tesla'].includes(vehicleMake)) premium += 500;
      if (vehicleYear > 2023) premium += 200;
      if (coverageType === 'comprehensive') premium += 400;
      if (coverageType === 'premium') premium += 800;
    } else if (type === 'home') {
      const { sqft, yearBuilt } = details;
      premium += (sqft || 1000) * 0.5;
      if (yearBuilt < 2000) premium += 300; // Older homes cost more
    } else if (type === 'life') {
      const { age, gender, smoker, coverageAmount, termLength } = details;
      let baseRate = (coverageAmount || 100000) * 0.005; // $5 per $1000
      
      if (age > 50) baseRate *= 1.5;
      if (age > 60) baseRate *= 2;
      if (smoker) baseRate *= 2;
      if (gender === 'male') baseRate *= 1.1; // Statistically higher risk
      
      premium = baseRate;
    }

    res.json({
      success: true,
      data: {
        premium: Math.round(premium),
        breakdown: {
          base: 1000,
          adjustments: Math.round(premium - 1000)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/policies
 * Create a new policy
 */
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { type, details, quoteId } = req.body;
    const customerId = req.user.customerId;
    const policyNumber = `POL${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
    
    // 1. Calculate final premium (reuse logic or trust frontend if secured, for now simple calc)
    let premium = 1200; 
    if (req.body.premium) premium = req.body.premium;

    const startDate = new Date().toISOString().split('T')[0];
    const endDate = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0];

    // 2. Insert into policies table
    await executeCommand(
      `INSERT INTO policies (policy_number, customer_id, policy_type, start_date, end_date, premium_amount, billing_frequency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [policyNumber, customerId, type, startDate, endDate, premium, 'monthly', 'active']
    );

    // 3. Insert details based on type
    if (type === 'auto') {
      await executeCommand(
        `INSERT INTO auto_policy_details (policy_number, vehicle_make, vehicle_model, vehicle_year, vehicle_vin, liability_limit, collision_deductible, comprehensive_deductible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          policyNumber, 
          details.vehicleMake, 
          details.vehicleModel, 
          details.vehicleYear, 
          details.vehicleVin || 'UNKNOWN',
          details.liabilityLimit || 50000,
          details.deductible || 500,
          details.deductible || 500
        ]
      );
    } else if (type === 'life') {
      await executeCommand(
        `INSERT INTO life_policy_details (policy_number, age, gender, smoker, coverage_amount, term_length)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          policyNumber,
          details.age,
          details.gender,
          details.smoker ? 1 : 0,
          details.coverageAmount,
          details.termLength
        ]
      );
    }

    // 4. Create initial bill
    const billId = `BILL${Date.now().toString().slice(-6)}`;
    const dueDate = new Date(new Date().setDate(new Date().getDate() + 15)).toISOString().split('T')[0]; // Due in 15 days
    
    // Check if we should use bill_date or billing_date based on error history
    // We'll use billing_date as it seems to be what's in the DB
    await executeCommand(
      `INSERT INTO billing (bill_id, policy_number, billing_date, due_date, amount_due, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [billId, policyNumber, startDate, dueDate, premium / 12, 'pending']
    );

    res.json({
      success: true,
      data: {
        policyNumber,
        status: 'active',
        message: 'Policy created successfully'
      }
    });

  } catch (error) {
    logger.error('Create policy error:', error);
    next(error);
  }
});

/**
 * Validation schemas
 */
const policyQuerySchema = Joi.object({
  policyNumber: Joi.string().required(),
  customerId: Joi.string().optional()
});

const policyPricingSchema = Joi.object({
  premiumAmount: Joi.number().min(0).required(),
  billingFrequency: Joi.string().valid('monthly', 'quarterly', 'annual').required(),
});

/**
 * GET /api/policy
 * List policies (agent/admin)
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'agent') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only agent/admin can list all policies'
      });
    }

    const { status, type, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        p.policy_number,
        p.policy_type,
        p.start_date,
        p.premium_amount,
        p.billing_frequency,
        p.status,
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.state
      FROM policies p
      JOIN customers c ON p.customer_id = c.customer_id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND p.status = ?';
      params.push(status);
    }
    if (type) {
      query += ' AND p.policy_type = ?';
      params.push(type);
    }

    query += ' ORDER BY p.start_date DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const policies = await executeQuery(query, params);

    let countQuery = `
      SELECT COUNT(*) as total
      FROM policies p
      WHERE 1=1
    `;
    const countParams = [];
    if (status) {
      countQuery += ' AND p.status = ?';
      countParams.push(status);
    }
    if (type) {
      countQuery += ' AND p.policy_type = ?';
      countParams.push(type);
    }

    const countResult = await executeQuery(countQuery, countParams);
    const total = countResult[0]?.total || 0;

    res.json({
      success: true,
      data: {
        policies,
        pagination: {
          limit: Number(limit),
          offset: Number(offset),
          total
        }
      }
    });
  } catch (error) {
    logger.error('Policies list error:', error);
    next(error);
  }
});

/**
 * PUT /api/policy/:policyNumber/pricing
 * Update premium and billing frequency (admin/agent)
 */
router.put('/:policyNumber/pricing', authenticateToken, async (req, res, next) => {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'agent') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only agent/admin can update policy pricing'
      });
    }

    const { policyNumber } = req.params;
    const { error, value } = policyPricingSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const existing = await executeQuery(
      `SELECT policy_number FROM policies WHERE policy_number = ? LIMIT 1`,
      [policyNumber]
    );
    if (!existing.length) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Policy ${policyNumber} not found`
      });
    }

    await executeCommand(
      `UPDATE policies SET premium_amount = ?, billing_frequency = ? WHERE policy_number = ?`,
      [value.premiumAmount, value.billingFrequency, policyNumber]
    );

    const updated = await executeQuery(
      `SELECT policy_number, customer_id, policy_type, start_date, premium_amount, billing_frequency, status, end_date
       FROM policies
       WHERE policy_number = ?`,
      [policyNumber]
    );

    res.json({
      success: true,
      message: 'Policy pricing updated',
      data: {
        policy: updated[0]
      }
    });
  } catch (error) {
    logger.error('Policy pricing update error:', error);
    next(error);
  }
});

/**
 * GET /api/policy/:policyNumber
 * Get policy details by policy number
 */
router.get('/:policyNumber', authenticateToken, async (req, res, next) => {
  try {
    const { policyNumber } = req.params;
    const { customerId } = req.query;

    logger.info(`Fetching policy details for policy number: ${policyNumber}`);

    // Query policy details with customer information
    const policyQuery = `
      SELECT 
        p.policy_number,
        p.policy_type,
        p.start_date,
        p.premium_amount,
        p.billing_frequency,
        p.status,
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.state
      FROM policies p
      JOIN customers c ON p.customer_id = c.customer_id
      WHERE p.policy_number = ?
    `;

    const role = req.user?.role;
    const requesterCustomerId = req.user?.customerId;
    if (role === 'customer' && !requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Customer access requires a linked customer ID'
      });
    }

    const policies = await executeQuery(policyQuery, [policyNumber]);

    if (policies.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Policy ${policyNumber} not found`
      });
    }

    const policy = policies[0];

    if (role === 'customer' && policy.customer_id !== requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Policy does not belong to the authenticated customer'
      });
    }

    // If customerId provided, verify ownership
    if (customerId && policy.customer_id !== customerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Policy does not belong to the specified customer'
      });
    }

    // Get auto policy details if it's an auto policy
    let autoDetails = null;
    if (policy.policy_type === 'auto') {
      const autoQuery = `
        SELECT 
          vehicle_vin,
          vehicle_make,
          vehicle_model,
          vehicle_year,
          liability_limit,
          collision_deductible,
          comprehensive_deductible,
          uninsured_motorist,
          rental_car_coverage
        FROM auto_policy_details
        WHERE policy_number = ?
      `;
      
      const autoResults = await executeQuery(autoQuery, [policyNumber]);
      autoDetails = autoResults.length > 0 ? autoResults[0] : null;
    }

    res.json({
      success: true,
      data: {
        policy: {
          ...policy,
          auto_details: autoDetails
        }
      }
    });

  } catch (error) {
    logger.error('Policy retrieval error:', error);
    next(error);
  }
});

/**
 * GET /api/policy/customer/:customerId
 * Get all policies for a customer
 */
router.get('/customer/:customerId', authenticateToken, async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const { status, type } = req.query;

    logger.info(`Fetching policies for customer: ${customerId}`);

    const role = req.user?.role;
    const requesterCustomerId = req.user?.customerId;
    if (role === 'customer' && customerId !== requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Customers can only access their own policies'
      });
    }
    if (role !== 'admin' && role !== 'agent' && role !== 'customer') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Unauthorized role'
      });
    }

    let query = `
      SELECT 
        p.policy_number,
        p.policy_type,
        p.start_date,
        p.premium_amount,
        p.billing_frequency,
        p.status,
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email
      FROM policies p
      JOIN customers c ON p.customer_id = c.customer_id
      WHERE c.customer_id = ?
    `;

    const params = [customerId];

    // Add filters
    if (status) {
      query += ' AND p.status = ?';
      params.push(status);
    }

    if (type) {
      query += ' AND p.policy_type = ?';
      params.push(type);
    }

    query += ' ORDER BY p.start_date DESC';

    const policies = await executeQuery(query, params);

    res.json({
      success: true,
      data: {
        policies,
        total: policies.length,
        customerId
      }
    });

  } catch (error) {
    logger.error('Customer policies retrieval error:', error);
    next(error);
  }
});

/**
 * GET /api/policy/search
 * Search policies by various criteria
 */
router.get('/search', async (req, res, next) => {
  try {
    const { 
      policyNumber, 
      customerName, 
      email, 
      phone, 
      status, 
      type,
      page = 1,
      limit = 20
    } = req.query;

    logger.info('Searching policies with criteria:', req.query);

    let query = `
      SELECT 
        p.policy_number,
        p.policy_type,
        p.start_date,
        p.premium_amount,
        p.billing_frequency,
        p.status,
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.state
      FROM policies p
      JOIN customers c ON p.customer_id = c.customer_id
      WHERE 1=1
    `;

    const params = [];

    // Add search criteria
    if (policyNumber) {
      query += ' AND p.policy_number LIKE ?';
      params.push(`%${policyNumber}%`);
    }

    if (customerName) {
      query += ' AND (c.first_name LIKE ? OR c.last_name LIKE ?)';
      params.push(`%${customerName}%`, `%${customerName}%`);
    }

    if (email) {
      query += ' AND c.email LIKE ?';
      params.push(`%${email}%`);
    }

    if (phone) {
      query += ' AND c.phone LIKE ?';
      params.push(`%${phone}%`);
    }

    if (status) {
      query += ' AND p.status = ?';
      params.push(status);
    }

    if (type) {
      query += ' AND p.policy_type = ?';
      params.push(type);
    }

    // Add pagination
    const offset = (page - 1) * limit;
    query += ' ORDER BY p.start_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const policies = await executeQuery(query, params);

    // Get total count for pagination
    const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as total FROM').replace(/ORDER BY.*?$/, '');
    const countResult = await executeQuery(countQuery, params.slice(0, -2)); // Remove LIMIT and OFFSET params
    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        policies,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Policy search error:', error);
    next(error);
  }
});

/**
 * GET /api/policy/stats
 * Get policy statistics
 */
router.get('/stats/overview', async (req, res, next) => {
  try {
    logger.info('Fetching policy statistics');

    // Get total policies count
    const totalPoliciesQuery = 'SELECT COUNT(*) as total FROM policies';
    const totalResult = await executeQuery(totalPoliciesQuery);
    const totalPolicies = totalResult[0].total;

    // Get policies by status
    const statusQuery = `
      SELECT status, COUNT(*) as count
      FROM policies
      GROUP BY status
    `;
    const statusResults = await executeQuery(statusQuery);

    // Get policies by type
    const typeQuery = `
      SELECT policy_type, COUNT(*) as count
      FROM policies
      GROUP BY policy_type
    `;
    const typeResults = await executeQuery(typeQuery);

    // Get recent policies (last 30 days)
    const recentQuery = `
      SELECT COUNT(*) as recent
      FROM policies
      WHERE start_date >= date('now', '-30 days')
    `;
    const recentResult = await executeQuery(recentQuery);
    const recentPolicies = recentResult[0].recent;

    // Calculate total premium
    const premiumQuery = 'SELECT SUM(premium_amount) as total FROM policies WHERE status = "active"';
    const premiumResult = await executeQuery(premiumQuery);
    const totalPremium = premiumResult[0].total || 0;

    res.json({
      success: true,
      data: {
        overview: {
          totalPolicies,
          recentPolicies,
          totalPremium: parseFloat(totalPremium).toFixed(2)
        },
        byStatus: statusResults.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {}),
        byType: typeResults.reduce((acc, item) => {
          acc[item.policy_type] = item.count;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    logger.error('Policy statistics error:', error);
    next(error);
  }
});

module.exports = router;
