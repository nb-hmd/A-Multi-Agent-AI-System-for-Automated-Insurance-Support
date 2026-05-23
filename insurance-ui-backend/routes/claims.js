const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');
const { executeQuery, executeCommand } = require('../config/realDatabase');
const { authenticateToken } = require('./auth');

const router = express.Router();

/**
 * Validation schemas
 */
const claimQuerySchema = Joi.object({
  claimId: Joi.string().required(),
  policyNumber: Joi.string().optional(),
  customerId: Joi.string().optional()
});

const createClaimSchema = Joi.object({
  policyNumber: Joi.string().required(),
  incidentType: Joi.string().min(2).max(100).required(),
  incidentDate: Joi.string().isoDate().required(),
  description: Joi.string().min(10).required(),
  estimatedLoss: Joi.number().min(0).required(),
  evidenceFiles: Joi.array().items(Joi.string()).optional()
});

async function nextId(prefix, table, column, width) {
  const rows = await executeQuery(
    `SELECT ${column} AS id FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`,
    [`${prefix}%`]
  );
  const last = rows && rows.length ? String(rows[0].id || '') : '';
  const m = last.match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
  const n = m ? Number(m[1]) : 0;
  return `${prefix}${String(n + 1).padStart(width, '0')}`;
}

/**
 * GET /api/claims
 * List claims (agent/admin)
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'agent') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only agent/admin can list all claims'
      });
    }

    const { status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        c.claim_id,
        c.policy_number,
        c.claim_date,
        c.incident_date,
        c.incident_type,
        c.description,
        c.estimated_loss,
        c.evidence_files,
        c.status,
        p.policy_type,
        cust.customer_id,
        cust.first_name,
        cust.last_name,
        cust.email
      FROM claims c
      JOIN policies p ON c.policy_number = p.policy_number
      JOIN customers cust ON p.customer_id = cust.customer_id
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      query += ' AND c.status = ?';
      params.push(status);
    }
    query += ' ORDER BY c.claim_date DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const claims = await executeQuery(query, params);

    let countQuery = `
      SELECT COUNT(*) as total
      FROM claims c
      WHERE 1=1
    `;
    const countParams = [];
    if (status) {
      countQuery += ' AND c.status = ?';
      countParams.push(status);
    }
    const countResult = await executeQuery(countQuery, countParams);
    const total = countResult[0]?.total || 0;

    res.json({
      success: true,
      data: {
        claims,
        pagination: {
          limit: Number(limit),
          offset: Number(offset),
          total
        }
      }
    });
  } catch (error) {
    logger.error('Claims list error:', error);
    next(error);
  }
});

/**
 * POST /api/claims/file
 * File a claim (customer)
 */
router.post('/file', authenticateToken, async (req, res, next) => {
  try {
    const role = req.user?.role;
    if (role !== 'customer') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only customers can file claims'
      });
    }

    const { error, value } = createClaimSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const ownerRows = await executeQuery(
      `SELECT customer_id FROM policies WHERE policy_number = ? LIMIT 1`,
      [value.policyNumber]
    );
    const ownerCustomerId = ownerRows.length ? ownerRows[0].customer_id : null;
    if (!ownerCustomerId) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Policy ${value.policyNumber} not found`
      });
    }
    if (ownerCustomerId !== req.user.customerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Policy does not belong to the authenticated customer'
      });
    }

    const claimId = await nextId('CLM', 'claims', 'claim_id', 6);
    const claimDate = new Date().toISOString().slice(0, 10);
    // Ensure evidence files is valid JSON string
    const evidenceJson = value.evidenceFiles ? JSON.stringify(value.evidenceFiles) : '[]';

    // Verify incident_date is not in future
    const incidentDateObj = new Date(value.incidentDate);
    const today = new Date();
    if (incidentDateObj > today) {
        return res.status(400).json({
            error: 'Validation Error',
            message: 'Incident date cannot be in the future'
        });
    }

    await executeCommand(
      `INSERT INTO claims (claim_id, policy_number, claim_date, incident_date, incident_type, description, estimated_loss, evidence_files, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [claimId, value.policyNumber, claimDate, value.incidentDate, value.incidentType, value.description, value.estimatedLoss, evidenceJson, 'pending']
    );

    const claim = await executeQuery(
      `SELECT claim_id, policy_number, claim_date, incident_date, incident_type, description, estimated_loss, evidence_files, status
       FROM claims
       WHERE claim_id = ?`,
      [claimId]
    );

    res.status(201).json({
      success: true,
      message: 'Claim filed',
      data: {
        claim: claim[0]
      }
    });
  } catch (error) {
    logger.error('Claim filing error:', error);
    next(error);
  }
});

/**
 * GET /api/claims/:claimId
 * Get claim details by claim ID
 */
router.get('/:claimId', authenticateToken, async (req, res, next) => {
  try {
    const { claimId } = req.params;
    const { policyNumber, customerId } = req.query;

    logger.info(`Fetching claim details for claim ID: ${claimId}`);

    // Get claim details with policy and customer information
    const claimQuery = `
      SELECT 
        c.claim_id,
        c.policy_number,
        c.claim_date,
        c.incident_type,
        c.estimated_loss,
        c.status,
        p.policy_type,
        p.start_date as policy_start_date,
        cust.customer_id,
        cust.first_name,
        cust.last_name,
        cust.email,
        cust.phone
      FROM claims c
      JOIN policies p ON c.policy_number = p.policy_number
      JOIN customers cust ON p.customer_id = cust.customer_id
      WHERE c.claim_id = ?
    `;

    const claims = await executeQuery(claimQuery, [claimId]);

    if (claims.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Claim not found'
      });
    }

    const claim = claims[0];

    const role = req.user?.role;
    const requesterCustomerId = req.user?.customerId;
    if (role === 'customer' && claim.customer_id !== requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Claim does not belong to the authenticated customer'
      });
    }

    // Verify customer ownership if customerId provided
    if (customerId && claim.customer_id !== customerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Claim does not belong to the specified customer'
      });
    }

    // Verify policy ownership if policyNumber provided
    if (policyNumber && claim.policy_number !== policyNumber) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Claim does not belong to the specified policy'
      });
    }

    res.json({
      success: true,
      data: {
        claim
      }
    });

  } catch (error) {
    logger.error('Claim retrieval error:', error);
    next(error);
  }
});

/**
 * GET /api/claims/policy/:policyNumber
 * Get all claims for a specific policy
 */
router.get('/policy/:policyNumber', authenticateToken, async (req, res, next) => {
  try {
    const { policyNumber } = req.params;
    const { customerId, status, limit = 20, offset = 0 } = req.query;

    logger.info(`Fetching claims for policy: ${policyNumber}`);

    const role = req.user?.role;
    const requesterCustomerId = req.user?.customerId;
    const ownerRows = await executeQuery(`SELECT customer_id FROM policies WHERE policy_number = ?`, [policyNumber]);
    const ownerCustomerId = ownerRows.length ? ownerRows[0].customer_id : null;
    if (!ownerCustomerId) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Policy ${policyNumber} not found`
      });
    }
    if (role === 'customer' && ownerCustomerId !== requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Claims do not belong to the authenticated customer'
      });
    }

    let query = `
      SELECT 
        c.claim_id,
        c.policy_number,
        c.claim_date,
        c.incident_type,
        c.estimated_loss,
        c.status,
        p.policy_type,
        cust.customer_id,
        cust.first_name,
        cust.last_name
      FROM claims c
      JOIN policies p ON c.policy_number = p.policy_number
      JOIN customers cust ON p.customer_id = cust.customer_id
      WHERE c.policy_number = ?
    `;

    const params = [policyNumber];

    if (status) {
      query += ' AND c.status = ?';
      params.push(status);
    }

    query += ' ORDER BY c.claim_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const claims = await executeQuery(query, params);

    if (claims.length === 0) {
      return res.json({
        success: true,
        data: {
          claims: []
        }
      });
    }

    if (role === 'customer' && claims[0].customer_id !== requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Claims do not belong to the authenticated customer'
      });
    }

    // Verify customer ownership if customerId provided
    if (customerId && claims[0].customer_id !== customerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Claims do not belong to the specified customer'
      });
    }

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM claims c
      JOIN policies p ON c.policy_number = p.policy_number
      WHERE c.policy_number = ?
      ${status ? ' AND c.status = ?' : ''}
    `;

    const countParams = status ? [policyNumber, status] : [policyNumber];
    const countResult = await executeQuery(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        claims,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Policy claims retrieval error:', error);
    next(error);
  }
});

/**
 * GET /api/claims/customer/:customerId
 * Get all claims for a specific customer
 */
router.get('/customer/:customerId', authenticateToken, async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const { status, limit = 20, offset = 0 } = req.query;

    logger.info(`Fetching claims for customer: ${customerId}`);

    const role = req.user?.role;
    const requesterCustomerId = req.user?.customerId;
    if (role === 'customer' && customerId !== requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Customers can only access their own claims'
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
        c.claim_id,
        c.policy_number,
        c.claim_date,
        c.incident_type,
        c.estimated_loss,
        c.status,
        p.policy_type,
        cust.first_name,
        cust.last_name
      FROM claims c
      JOIN policies p ON c.policy_number = p.policy_number
      JOIN customers cust ON p.customer_id = cust.customer_id
      WHERE cust.customer_id = ?
    `;

    const params = [customerId];

    if (status) {
      query += ' AND c.status = ?';
      params.push(status);
    }

    query += ' ORDER BY c.claim_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const claims = await executeQuery(query, params);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM claims c
      JOIN policies p ON c.policy_number = p.policy_number
      WHERE p.customer_id = ?
      ${status ? ' AND c.status = ?' : ''}
    `;

    const countParams = status ? [customerId, status] : [customerId];
    const countResult = await executeQuery(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        claims,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Customer claims retrieval error:', error);
    next(error);
  }
});

/**
 * GET /api/claims/search
 * Search claims by various criteria
 */
router.get('/search', authenticateToken, async (req, res, next) => {
  try {
    const { 
      claimId, 
      policyNumber, 
      customerName, 
      incidentType, 
      status,
      dateFrom,
      dateTo,
      page = 1,
      limit = 20
    } = req.query;

    const role = req.user?.role;
    if (role !== 'admin' && role !== 'agent') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only agent/admin can search claims'
      });
    }

    logger.info('Searching claims with criteria:', req.query);

    let query = `
      SELECT 
        c.claim_id,
        c.policy_number,
        c.claim_date,
        c.incident_type,
        c.estimated_loss,
        c.status,
        p.policy_type,
        cust.customer_id,
        cust.first_name,
        cust.last_name,
        cust.email
      FROM claims c
      JOIN policies p ON c.policy_number = p.policy_number
      JOIN customers cust ON p.customer_id = cust.customer_id
      WHERE 1=1
    `;

    const params = [];

    // Add search criteria
    if (claimId) {
      query += ' AND c.claim_id LIKE ?';
      params.push(`%${claimId}%`);
    }

    if (policyNumber) {
      query += ' AND c.policy_number LIKE ?';
      params.push(`%${policyNumber}%`);
    }

    if (customerName) {
      query += ' AND (cust.first_name LIKE ? OR cust.last_name LIKE ?)';
      params.push(`%${customerName}%`, `%${customerName}%`);
    }

    if (incidentType) {
      query += ' AND c.incident_type LIKE ?';
      params.push(`%${incidentType}%`);
    }

    if (status) {
      query += ' AND c.status = ?';
      params.push(status);
    }

    if (dateFrom) {
      query += ' AND c.claim_date >= ?';
      params.push(dateFrom);
    }

    if (dateTo) {
      query += ' AND c.claim_date <= ?';
      params.push(dateTo);
    }

    // Add pagination
    const offset = (page - 1) * limit;
    query += ' ORDER BY c.claim_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const claims = await executeQuery(query, params);

    // Get total count for pagination
    const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as total FROM').replace(/ORDER BY.*?$/, '');
    const countResult = await executeQuery(countQuery, params.slice(0, -2)); // Remove LIMIT and OFFSET params
    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        claims,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Claims search error:', error);
    next(error);
  }
});

/**
 * GET /api/claims/stats
 * Get claims statistics
 */
router.get('/stats/overview', async (req, res, next) => {
  try {
    logger.info('Fetching claims statistics');

    // Get total claims count
    const totalClaimsQuery = 'SELECT COUNT(*) as total FROM claims';
    const totalResult = await executeQuery(totalClaimsQuery);
    const totalClaims = totalResult[0].total;

    // Get claims by status
    const statusQuery = `
      SELECT status, COUNT(*) as count, SUM(estimated_loss) as total_estimated_loss
      FROM claims
      GROUP BY status
    `;
    const statusResults = await executeQuery(statusQuery);

    // Get claims by incident type
    const incidentQuery = `
      SELECT incident_type, COUNT(*) as count, AVG(estimated_loss) as avg_estimated_loss
      FROM claims
      GROUP BY incident_type
      ORDER BY count DESC
    `;
    const incidentResults = await executeQuery(incidentQuery);

    // Get recent claims (last 30 days)
    const recentQuery = `
      SELECT COUNT(*) as recent_claims, SUM(estimated_loss) as recent_loss
      FROM claims
      WHERE claim_date >= date('now', '-30 days')
    `;
    const recentResult = await executeQuery(recentQuery);
    const recentClaims = recentResult[0].recent_claims;
    const recentLoss = recentResult[0].recent_loss || 0;

    // Calculate settlement ratio
    const settlementQuery = `
      SELECT 
        COUNT(CASE WHEN status = 'settled' THEN 1 END) as settled_count,
        COUNT(*) as total_count
      FROM claims
    `;
    const settlementResult = await executeQuery(settlementQuery);
    const settlementRatio = settlementResult[0].total_count > 0 
      ? (settlementResult[0].settled_count / settlementResult[0].total_count * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      data: {
        overview: {
          totalClaims,
          recentClaims,
          recentLoss: parseFloat(recentLoss).toFixed(2),
          settlementRatio: parseFloat(settlementRatio).toFixed(2)
        },
        byStatus: statusResults.reduce((acc, item) => {
          acc[item.status] = {
            count: item.count,
            totalEstimatedLoss: parseFloat(item.total_estimated_loss || 0).toFixed(2),
            totalSettlement: parseFloat(item.total_settlement || 0).toFixed(2)
          };
          return acc;
        }, {}),
        byIncidentType: incidentResults.reduce((acc, item) => {
          acc[item.incident_type] = {
            count: item.count,
            avgEstimatedLoss: parseFloat(item.avg_estimated_loss || 0).toFixed(2)
          };
          return acc;
        }, {})
      }
    });

  } catch (error) {
    logger.error('Claims statistics error:', error);
    next(error);
  }
});

module.exports = router;
