const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { executeQuery, executeCommand, isConnected } = require('../config/realDatabase');

class AuthService {
  constructor() {
    this.users = new Map();
    this._initPromise = null;
  }

  async ensureInitialized() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      if (!isConnected()) {
        this._initPromise = null;
        throw new Error('Database not connected');
      }

      await executeCommand(`
        CREATE TABLE IF NOT EXISTS app_users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          email TEXT,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL,
          customer_id TEXT,
          first_name TEXT,
          last_name TEXT,
          phone TEXT,
          state TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const existing = await executeQuery('SELECT id FROM app_users LIMIT 1');
      if (!existing || existing.length === 0) {
        const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
        const now = new Date().toISOString();
        const seed = [
          {
            id: 'user_admin',
            username: 'admin',
            email: 'admin@insurance.com',
            password_hash: bcrypt.hashSync('admin123', rounds),
            role: 'admin',
            customer_id: null,
            first_name: 'System',
            last_name: 'Administrator',
            phone: null,
            state: null,
            created_at: now,
          },
          {
            id: 'user_agent',
            username: 'agent',
            email: 'agent@insurance.com',
            password_hash: bcrypt.hashSync('agent123', rounds),
            role: 'agent',
            customer_id: null,
            first_name: 'Customer',
            last_name: 'Service Agent',
            phone: null,
            state: null,
            created_at: now,
          },
          {
            id: 'user_customer_CUST00001',
            username: 'customer',
            email: 'user1@example.com',
            password_hash: bcrypt.hashSync('customer123', rounds),
            role: 'customer',
            customer_id: 'CUST00001',
            first_name: 'Kevin',
            last_name: 'Lopez',
            phone: '555-635-3600',
            state: 'TX',
            created_at: now,
          },
        ];

        for (const u of seed) {
          await executeCommand(
            `INSERT INTO app_users (id, username, email, password_hash, role, customer_id, first_name, last_name, phone, state, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [u.id, u.username, u.email, u.password_hash, u.role, u.customer_id, u.first_name, u.last_name, u.phone, u.state, u.created_at]
          );
        }
      }

      await this._loadUsersFromDb();
      logger.info('Auth users loaded from database');
    })();

    return this._initPromise;
  }

  async _loadUsersFromDb() {
    const rows = await executeQuery('SELECT * FROM app_users');
    this.users.clear();
    for (const row of rows || []) {
      this.users.set(row.id, {
        id: row.id,
        username: row.username,
        email: row.email,
        password: row.password_hash,
        role: row.role,
        customerId: row.customer_id,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone,
        state: row.state,
        createdAt: row.created_at,
        lastLogin: null,
      });
    }
  }

  async login(username, password) {
    try {
      await this.ensureInitialized();
      const user = Array.from(this.users.values()).find(
        (u) => u.username === username || u.email === username
      );

      if (!user) {
        throw new Error('Invalid credentials');
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new Error('Invalid credentials');
      }

      const token = jwt.sign(
        {
          userId: user.id,
          username: user.username,
          role: user.role,
          customerId: user.customerId,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      const { password: _, ...userWithoutPassword } = user;

      logger.info(`User ${username} logged in successfully`);

      return {
        token,
        user: userWithoutPassword,
      };
    } catch (error) {
      logger.error(`Login failed for user ${username}:`, error);
      throw error;
    }
  }

  async register(userData) {
    try {
      await this.ensureInitialized();
      const { username, email, password, firstName, lastName, role = 'customer' } = userData;

      const existingUser = await executeQuery(
        `SELECT id FROM app_users WHERE username = ? OR email = ? LIMIT 1`,
        [username, email]
      );
      if (existingUser && existingUser.length) {
        throw new Error('User already exists');
      }

      const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
      const newUser = {
        id: uuidv4(),
        username,
        email,
        password: hashedPassword,
        firstName,
        lastName,
        role,
        customerId: null,
        createdAt: new Date().toISOString(),
        lastLogin: null,
      };

      await executeCommand(
        `INSERT INTO app_users (id, username, email, password_hash, role, customer_id, first_name, last_name, phone, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newUser.id,
          newUser.username,
          newUser.email,
          newUser.password,
          newUser.role,
          newUser.customerId,
          newUser.firstName,
          newUser.lastName,
          null,
          null,
          newUser.createdAt,
        ]
      );

      this.users.set(newUser.id, newUser);
      const { password: _, ...userWithoutPassword } = newUser;
      logger.info(`New user ${username} registered successfully`);
      return userWithoutPassword;
    } catch (error) {
      logger.error('User registration failed:', error);
      throw error;
    }
  }

  async verifyToken(token) {
    try {
      await this.ensureInitialized();
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = this.users.get(decoded.userId);
      if (!user) {
        throw new Error('User not found');
      }
      const { password: _, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      logger.error('Token verification failed:', error);
      throw new Error('Invalid token');
    }
  }

  async getUserById(userId) {
    await this.ensureInitialized();
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async updateLastLogin(userId) {
    await this.ensureInitialized();
    const user = this.users.get(userId);
    if (user) {
      user.lastLogin = new Date().toISOString();
      logger.info(`Updated last login for user ${user.username}`);
    }
  }

  async updateUserProfile(userId, updates) {
    await this.ensureInitialized();
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const allowed = ['firstName', 'lastName', 'email', 'phone', 'state'];
    allowed.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(updates, k)) {
        const val = updates[k];
        user[k] = val === '' ? null : val;
      }
    });

    await executeCommand(
      `UPDATE app_users
       SET email = ?, first_name = ?, last_name = ?, phone = ?, state = ?
       WHERE id = ?`,
      [user.email, user.firstName, user.lastName, user.phone, user.state, user.id]
    );

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async getAllUsers() {
    await this.ensureInitialized();
    return Array.from(this.users.values()).map((user) => {
      const { password: _, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });
  }

  async changePassword(userId, currentPassword, newPassword) {
    try {
      await this.ensureInitialized();
      const user = this.users.get(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      const hashedNewPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
      user.password = hashedNewPassword;

      await executeCommand(`UPDATE app_users SET password_hash = ? WHERE id = ?`, [user.password, user.id]);

      logger.info(`Password changed for user ${user.username}`);
      return { message: 'Password changed successfully' };
    } catch (error) {
      logger.error(`Password change failed for user ${userId}:`, error);
      throw error;
    }
  }

  async createCustomerAccount(payload) {
    await this.ensureInitialized();
    const { username, password, firstName, lastName, email, phone, address, city, state, zipCode, dateOfBirth, policyTypes } = payload;

    const existingUser = await executeQuery(
      `SELECT id FROM app_users WHERE username = ? OR email = ? LIMIT 1`,
      [username, email]
    );
    if (existingUser && existingUser.length) {
      throw new Error('User already exists');
    }

    const existingCustomerEmail = await executeQuery(
      `SELECT customer_id FROM customers WHERE email = ? LIMIT 1`,
      [email]
    );
    if (existingCustomerEmail && existingCustomerEmail.length) {
      throw new Error('A customer with this email already exists');
    }

    const customerId = await this._nextCustomerId();
    await this._insertCustomerRow({
      customer_id: customerId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
      zip_code: zipCode || null,
      date_of_birth: dateOfBirth || null,
    });

    const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const userId = uuidv4();
    const createdAt = new Date().toISOString();

    await executeCommand(
      `INSERT INTO app_users (id, username, email, password_hash, role, customer_id, first_name, last_name, phone, state, created_at)
       VALUES (?, ?, ?, ?, 'customer', ?, ?, ?, ?, ?, ?)`,
      [userId, username, email, hashedPassword, customerId, firstName, lastName, phone || null, state || null, createdAt]
    );

    const user = {
      id: userId,
      username,
      email,
      password: hashedPassword,
      role: 'customer',
      customerId,
      firstName,
      lastName,
      phone: phone || null,
      state: state || null,
      createdAt,
      lastLogin: null,
    };
    this.users.set(user.id, user);

    const createdPolicies = await this._createPoliciesForCustomer(customerId, policyTypes);

    const { password: _, ...userWithoutPassword } = user;
    return { user: userWithoutPassword, customer: { customerId }, policies: createdPolicies };
  }

  async _createPoliciesForCustomer(customerId, policyTypes) {
    const types = Array.isArray(policyTypes) ? policyTypes : [];
    const normalized = Array.from(
      new Set(
        types
          .map((t) => String(t || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );
    if (!normalized.length) return [];

    const created = [];
    const startDate = new Date().toISOString().slice(0, 10);
    for (const t of normalized) {
      const policyNumber = await this._nextPolicyNumber();
      await executeCommand(
        `INSERT INTO policies (policy_number, customer_id, policy_type, premium_amount, billing_frequency, status, start_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [policyNumber, customerId, t, 0, 'monthly', 'active', startDate]
      );
      created.push({ policyNumber, policyType: t, status: 'active', startDate, premiumAmount: 0, billingFrequency: 'monthly' });
    }
    return created;
  }

  async _nextCustomerId() {
    const rows = await executeQuery(
      `SELECT customer_id
       FROM customers
       WHERE customer_id LIKE 'CUST%'
       ORDER BY customer_id DESC
       LIMIT 1`
    );
    const last = rows && rows.length ? String(rows[0].customer_id || '') : '';
    const m = last.match(/^CUST(\d+)$/i);
    const n = m ? Number(m[1]) : 0;
    return `CUST${String(n + 1).padStart(5, '0')}`;
  }

  async _insertCustomerRow(data) {
    const cols = await executeQuery(`PRAGMA table_info(customers)`);
    const available = new Set((cols || []).map((c) => String(c.name || '').toLowerCase()));
    const candidates = [
      'customer_id',
      'first_name',
      'last_name',
      'email',
      'phone',
      'address',
      'city',
      'state',
      'zip_code',
      'date_of_birth',
      'created_at',
    ];

    const columns = [];
    const values = [];
    const params = [];
    for (const c of candidates) {
      if (!available.has(c)) continue;
      columns.push(c);
      if (c === 'created_at') {
        values.push('CURRENT_TIMESTAMP');
      } else {
        values.push('?');
        params.push(data[c] ?? null);
      }
    }

    if (!columns.includes('customer_id') || !columns.includes('first_name') || !columns.includes('last_name') || !columns.includes('email')) {
      throw new Error('Customers table schema is missing required columns');
    }

    await executeCommand(
      `INSERT INTO customers (${columns.join(', ')}) VALUES (${values.join(', ')})`,
      params
    );
  }

  async _nextPolicyNumber() {
    const rows = await executeQuery(
      `SELECT policy_number
       FROM policies
       WHERE policy_number LIKE 'POL%'
       ORDER BY policy_number DESC
       LIMIT 1`
    );
    const last = rows && rows.length ? String(rows[0].policy_number || '') : '';
    const m = last.match(/^POL(\d+)$/i);
    const n = m ? Number(m[1]) : 0;
    return `POL${String(n + 1).padStart(6, '0')}`;
  }
}

const authService = new AuthService();
module.exports = authService;
