const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');
const { executeQuery, executeCommand } = require('../config/realDatabase');
const { authenticateToken } = require('./auth');

const router = express.Router();

/**
 * Validation schemas
 */
const billingQuerySchema = Joi.object({
  policyNumber: Joi.string().required(),
  customerId: Joi.string().optional()
});

const createInvoiceSchema = Joi.object({
  billingDate: Joi.string().allow('', null),
  dueDate: Joi.string().allow('', null),
  amountDue: Joi.number().min(0).allow(null),
  status: Joi.string().valid('pending', 'paid', 'overdue').default('pending'),
});

const payBillSchema = Joi.object({
  amount: Joi.number().min(0.01).required(),
  paymentMethod: Joi.string().valid('card', 'bank_transfer', 'cash').required(),
  transactionId: Joi.string().allow('', null),
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
 * GET /api/billing
 * List billing records (agent/admin)
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'agent') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only agent/admin can list all billing records'
      });
    }

    const { status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT
        b.bill_id,
        b.policy_number,
        b.billing_date,
        b.due_date,
        b.amount_due,
        b.status,
        p.policy_type,
        p.premium_amount,
        p.billing_frequency,
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email
      FROM billing b
      JOIN policies p ON b.policy_number = p.policy_number
      JOIN customers c ON p.customer_id = c.customer_id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND b.status = ?';
      params.push(status);
    }

    query += ' ORDER BY b.billing_date DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const billing = await executeQuery(query, params);

    let countQuery = `
      SELECT COUNT(*) as total
      FROM billing b
      WHERE 1=1
    `;
    const countParams = [];
    if (status) {
      countQuery += ' AND b.status = ?';
      countParams.push(status);
    }

    const countResult = await executeQuery(countQuery, countParams);
    const total = countResult[0]?.total || 0;

    res.json({
      success: true,
      data: {
        billing,
        pagination: {
          limit: Number(limit),
          offset: Number(offset),
          total
        }
      }
    });
  } catch (error) {
    logger.error('Billing list error:', error);
    next(error);
  }
});

/**
 * POST /api/billing/policy/:policyNumber/invoice
 * Generate a billing invoice (admin/agent)
 */
router.post('/policy/:policyNumber/invoice', authenticateToken, async (req, res, next) => {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'agent') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only agent/admin can generate invoices'
      });
    }

    const { policyNumber } = req.params;
    const { error, value } = createInvoiceSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const policyRows = await executeQuery(
      `SELECT policy_number, customer_id, premium_amount, billing_frequency, status
       FROM policies
       WHERE policy_number = ?
       LIMIT 1`,
      [policyNumber]
    );
    if (!policyRows.length) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Policy ${policyNumber} not found`
      });
    }

    const policy = policyRows[0];
    const today = new Date();
    const billingDate = value.billingDate && String(value.billingDate).trim()
      ? String(value.billingDate).trim()
      : today.toISOString().slice(0, 10);

    const due = new Date(today.getTime());
    due.setDate(due.getDate() + 30);
    const dueDate = value.dueDate && String(value.dueDate).trim()
      ? String(value.dueDate).trim()
      : due.toISOString().slice(0, 10);

    const amountDue = value.amountDue == null ? Number(policy.premium_amount || 0) : Number(value.amountDue);
    const billId = await nextId('BILL', 'billing', 'bill_id', 6);

    await executeCommand(
      `INSERT INTO billing (bill_id, policy_number, billing_date, due_date, amount_due, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [billId, policyNumber, billingDate, dueDate, amountDue, value.status]
    );

    const created = await executeQuery(
      `SELECT bill_id, policy_number, billing_date, due_date, amount_due, status
       FROM billing
       WHERE bill_id = ?`,
      [billId]
    );

    res.status(201).json({
      success: true,
      message: 'Invoice generated',
      data: {
        billing: created[0]
      }
    });
  } catch (error) {
    logger.error('Invoice generation error:', error);
    next(error);
  }
});

/**
 * POST /api/billing/bill/:billId/pay
 * Create a payment record for a bill (customer)
 */
router.post('/bill/:billId/pay', authenticateToken, async (req, res, next) => {
  try {
    const role = req.user?.role;
    if (role !== 'customer') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only customers can make payments'
      });
    }

    const { billId } = req.params;
    const { error, value } = payBillSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const billRows = await executeQuery(
      `SELECT b.bill_id, b.policy_number, b.amount_due, b.status, p.customer_id
       FROM billing b
       JOIN policies p ON b.policy_number = p.policy_number
       WHERE b.bill_id = ?
       LIMIT 1`,
      [billId]
    );
    if (!billRows.length) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Bill ${billId} not found`
      });
    }

    const bill = billRows[0];
    if (bill.customer_id !== req.user.customerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Bill does not belong to the authenticated customer'
      });
    }

    const paymentId = await nextId('PAY', 'payments', 'payment_id', 6);
    const paymentDate = new Date().toISOString().slice(0, 10);
    const tx = value.transactionId && String(value.transactionId).trim() ? String(value.transactionId).trim() : null;

    await executeCommand(
      `INSERT INTO payments (payment_id, bill_id, payment_date, amount, payment_method, transaction_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [paymentId, billId, paymentDate, value.amount, value.paymentMethod, tx, 'completed']
    );

    const totals = await executeQuery(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM payments
       WHERE bill_id = ? AND status = 'completed'`,
      [billId]
    );
    const totalPaid = totals.length ? Number(totals[0].total || 0) : 0;
    const amountDue = Number(bill.amount_due || 0);
    const nextStatus = totalPaid >= amountDue && amountDue > 0 ? 'paid' : bill.status;
    if (nextStatus !== bill.status) {
      await executeCommand(`UPDATE billing SET status = ? WHERE bill_id = ?`, [nextStatus, billId]);
    }

    const payment = await executeQuery(
      `SELECT payment_id, bill_id, payment_date, amount, payment_method, transaction_id, status
       FROM payments
       WHERE payment_id = ?`,
      [paymentId]
    );
    const updatedBill = await executeQuery(
      `SELECT bill_id, policy_number, billing_date, due_date, amount_due, status
       FROM billing
       WHERE bill_id = ?`,
      [billId]
    );

    res.status(201).json({
      success: true,
      message: 'Payment recorded',
      data: {
        payment: payment[0],
        billing: updatedBill[0],
        paymentSummary: {
          totalPaid,
          amountDue,
          remaining: Math.max(0, amountDue - totalPaid),
        }
      }
    });
  } catch (error) {
    logger.error('Payment creation error:', error);
    next(error);
  }
});

/**
 * GET /api/billing/policy/:policyNumber
 * Get billing information for a specific policy
 */
router.get('/policy/:policyNumber', authenticateToken, async (req, res, next) => {
  try {
    const { policyNumber } = req.params;
    const { customerId } = req.query;

    logger.info(`Fetching billing information for policy: ${policyNumber}`);

    // Get current billing information
    const billingQuery = `
      SELECT 
        b.bill_id,
        b.policy_number,
        b.billing_date,
        b.due_date,
        b.amount_due,
        b.status,
        p.premium_amount,
        p.billing_frequency,
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email
      FROM billing b
      JOIN policies p ON b.policy_number = p.policy_number
      JOIN customers c ON p.customer_id = c.customer_id
      WHERE b.policy_number = ?
      ORDER BY b.billing_date DESC
      LIMIT 1
    `;

    const role = req.user?.role;
    const requesterCustomerId = req.user?.customerId;
    if (role === 'customer' && !requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Customer access requires a linked customer ID'
      });
    }

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
        message: 'Billing does not belong to the authenticated customer'
      });
    }

    const billingResults = await executeQuery(billingQuery, [policyNumber]);

    if (billingResults.length === 0) {
      return res.json({
        success: true,
        data: {
          billing: null,
          recentPayments: [],
          paymentSummary: {
            totalPaid: 0,
            paymentCount: 0,
            lastPaymentDate: null
          }
        }
      });
    }

    const currentBilling = billingResults[0];

    if (role === 'customer' && currentBilling.customer_id !== requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Billing does not belong to the authenticated customer'
      });
    }

    // Verify customer ownership if customerId provided
    if (customerId && currentBilling.customer_id !== customerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Billing information does not belong to the specified customer'
      });
    }

    // Get payment history for this policy
    const paymentsQuery = `
      SELECT 
        p.payment_id,
        p.payment_date,
        p.amount,
        p.payment_method,
        p.transaction_id,
        p.status,
        p.bill_id
      FROM payments p
      WHERE p.bill_id = ?
      ORDER BY p.payment_date DESC
      LIMIT 10
    `;

    const payments = await executeQuery(paymentsQuery, [currentBilling.bill_id]);

    // Calculate payment summary
    const totalPaid = payments
      .filter(payment => payment.status === 'completed')
      .reduce((sum, payment) => sum + parseFloat(payment.amount), 0);

    res.json({
      success: true,
      data: {
        billing: currentBilling,
        recentPayments: payments,
        paymentSummary: {
          totalPaid: totalPaid,
          paymentCount: payments.length,
          lastPaymentDate: payments.length > 0 ? payments[0].payment_date : null
        }
      }
    });

  } catch (error) {
    logger.error('Billing retrieval error:', error);
    next(error);
  }
});

/**
 * GET /api/billing/history/:policyNumber
 * Get complete billing and payment history for a policy
 */
router.get('/history/:policyNumber', authenticateToken, async (req, res, next) => {
  try {
    const { policyNumber } = req.params;
    const { customerId, limit = 50, offset = 0 } = req.query;

    logger.info(`Fetching billing history for policy: ${policyNumber}`);

    const role = req.user?.role;
    const requesterCustomerId = req.user?.customerId;
    if (role === 'customer' && !requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Customer access requires a linked customer ID'
      });
    }

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
        message: 'Billing history does not belong to the authenticated customer'
      });
    }

    // Get billing history with payments
    const historyQuery = `
      SELECT 
        b.bill_id,
        b.billing_date,
        b.due_date,
        b.amount_due,
        b.status as bill_status,
        p.payment_id,
        p.payment_date,
        p.amount as payment_amount,
        p.payment_method,
        p.transaction_id,
        p.status as payment_status
      FROM billing b
      LEFT JOIN payments p ON b.bill_id = p.bill_id
      WHERE b.policy_number = ?
      ORDER BY b.billing_date DESC, p.payment_date DESC
      LIMIT ? OFFSET ?
    `;

    const historyResults = await executeQuery(historyQuery, [
      policyNumber, 
      parseInt(limit), 
      parseInt(offset)
    ]);

    if (historyResults.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No billing history found for this policy'
      });
    }

    if (customerId && ownerCustomerId && ownerCustomerId !== customerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Billing history does not belong to the specified customer'
      });
    }

    // Organize data by billing period
    const billingHistory = {};
    
    historyResults.forEach(row => {
      const billKey = row.bill_id;
      
      if (!billingHistory[billKey]) {
        billingHistory[billKey] = {
          billId: row.bill_id,
          billingDate: row.billing_date,
          dueDate: row.due_date,
          amountDue: row.amount_due,
          billStatus: row.bill_status,
          payments: []
        };
      }

      if (row.payment_id) {
        billingHistory[billKey].payments.push({
          paymentId: row.payment_id,
          paymentDate: row.payment_date,
          amount: row.payment_amount,
          paymentMethod: row.payment_method,
          transactionId: row.transaction_id,
          status: row.payment_status
        });
      }
    });

    const organizedHistory = Object.values(billingHistory);

    res.json({
      success: true,
      data: {
        billingHistory: organizedHistory,
        totalBills: organizedHistory.length,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: organizedHistory.length
        }
      }
    });

  } catch (error) {
    logger.error('Billing history retrieval error:', error);
    next(error);
  }
});

/**
 * GET /api/billing/customer/:customerId
 * Get all billing information for a customer
 */
router.get('/customer/:customerId', authenticateToken, async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const { status, limit = 20, offset = 0 } = req.query;

    logger.info(`Fetching billing information for customer: ${customerId}`);

    const role = req.user?.role;
    const requesterCustomerId = req.user?.customerId;
    if (role === 'customer' && customerId !== requesterCustomerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Customers can only access their own billing'
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
        b.bill_id,
        b.policy_number,
        b.billing_date,
        b.due_date,
        b.amount_due,
        b.status,
        p.policy_type,
        p.premium_amount,
        p.billing_frequency,
        c.first_name,
        c.last_name
      FROM billing b
      JOIN policies p ON b.policy_number = p.policy_number
      JOIN customers c ON p.customer_id = c.customer_id
      WHERE c.customer_id = ?
    `;

    const params = [customerId];

    if (status) {
      query += ' AND b.status = ?';
      params.push(status);
    }

    query += ' ORDER BY b.billing_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const billingResults = await executeQuery(query, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM billing b
      JOIN policies p ON b.policy_number = p.policy_number
      WHERE p.customer_id = ?
      ${status ? ' AND b.status = ?' : ''}
    `;

    const countParams = status ? [customerId, status] : [customerId];
    const countResult = await executeQuery(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      data: {
        billing: billingResults,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Customer billing retrieval error:', error);
    next(error);
  }
});

/**
 * GET /api/billing/stats
 * Get billing statistics
 */
router.get('/stats/overview', authenticateToken, async (req, res, next) => {
  try {
    logger.info('Fetching billing statistics');

    const role = req.user?.role;
    if (role !== 'admin' && role !== 'agent') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only agent/admin can access billing statistics'
      });
    }

    // Get total billing amount
    const totalBillingQuery = 'SELECT SUM(amount_due) as total FROM billing';
    const totalResult = await executeQuery(totalBillingQuery);
    const totalBilling = totalResult[0].total || 0;

    // Get billing by status
    const statusQuery = `
      SELECT status, COUNT(*) as count, SUM(amount_due) as total_amount
      FROM billing
      GROUP BY status
    `;
    const statusResults = await executeQuery(statusQuery);

    // Get overdue bills
    const overdueQuery = `
      SELECT COUNT(*) as overdue_count, SUM(amount_due) as overdue_amount
      FROM billing
      WHERE due_date < date('now') AND status = 'pending'
    `;
    const overdueResult = await executeQuery(overdueQuery);
    const overdueCount = overdueResult[0].overdue_count;
    const overdueAmount = overdueResult[0].overdue_amount || 0;

    // Get recent billing (last 30 days)
    const recentQuery = `
      SELECT COUNT(*) as recent_bills, SUM(amount_due) as recent_amount
      FROM billing
      WHERE billing_date >= date('now', '-30 days')
    `;
    const recentResult = await executeQuery(recentQuery);
    const recentBills = recentResult[0].recent_bills;
    const recentAmount = recentResult[0].recent_amount || 0;

    res.json({
      success: true,
      data: {
        overview: {
          totalBilling: parseFloat(totalBilling).toFixed(2),
          overdueCount,
          overdueAmount: parseFloat(overdueAmount).toFixed(2),
          recentBills,
          recentAmount: parseFloat(recentAmount).toFixed(2)
        },
        byStatus: statusResults.reduce((acc, item) => {
          acc[item.status] = {
            count: item.count,
            totalAmount: parseFloat(item.total_amount).toFixed(2)
          };
          return acc;
        }, {})
      }
    });

  } catch (error) {
    logger.error('Billing statistics error:', error);
    next(error);
  }
});

module.exports = router;
