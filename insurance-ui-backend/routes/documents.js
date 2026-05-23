
const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');
const { executeQuery, executeCommand } = require('../config/realDatabase');
const { authenticateToken } = require('./auth');

const router = express.Router();

/**
 * GET /api/documents
 * List documents for the authenticated customer
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const role = req.user?.role;
    const customerId = req.user?.customerId;

    if (role !== 'customer' && role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only customers can access their documents'
      });
    }

    // 1. Fetch policies for this customer to generate ID Cards
    const policies = await executeQuery(
      `SELECT p.policy_number, p.policy_type, p.start_date, p.end_date, p.status, 
              c.first_name, c.last_name, 
              ap.vehicle_make, ap.vehicle_model, ap.vehicle_year, ap.vehicle_vin
       FROM policies p
       JOIN customers c ON p.customer_id = c.customer_id
       LEFT JOIN auto_policy_details ap ON p.policy_number = ap.policy_number
       WHERE p.customer_id = ? AND p.status = 'active'`,
      [customerId]
    );

    // 2. Generate "Virtual" Documents based on policies
    const documents = [];

    // ID Cards (One per active Auto Policy)
    policies.forEach(p => {
      if (p.policy_type === 'auto') {
        documents.push({
          id: `doc_idcard_${p.policy_number}`,
          title: `Auto ID Card - ${p.vehicle_year} ${p.vehicle_make}`,
          type: 'ID Card',
          date: p.start_date,
          category: 'identification',
          policyNumber: p.policy_number,
          metadata: {
             insured: `${p.first_name} ${p.last_name}`,
             vehicle: `${p.vehicle_year} ${p.vehicle_make} ${p.vehicle_model}`,
             vin: p.vehicle_vin,
             effective: p.start_date,
             expires: p.end_date
          }
        });
      }
      
      // Policy Contract (One per active Policy)
      documents.push({
        id: `doc_contract_${p.policy_number}`,
        title: `${p.policy_type.toUpperCase()} Policy Contract`,
        type: 'Contract',
        date: p.start_date,
        category: 'policy',
        policyNumber: p.policy_number
      });
    });

    // 3. Add some mock uploaded documents
    documents.push({
      id: 'doc_license_front',
      title: 'Drivers License (Front)',
      type: 'Upload',
      date: '2023-01-15',
      category: 'personal'
    });

    res.json({
      success: true,
      data: {
        documents
      }
    });

  } catch (error) {
    logger.error('Documents list error:', error);
    next(error);
  }
});

module.exports = router;
