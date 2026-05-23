const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../utils/logger');

let sqliteDb;
let isConnected = false;

async function ensureSchema() {
  const getColumns = (table) =>
    new Promise((resolve, reject) => {
      sqliteDb.all(`PRAGMA table_info(${table})`, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

  const hasColumn = async (table, column) => {
    const cols = await getColumns(table);
    return cols.some((c) => String(c.name || '').toLowerCase() === String(column).toLowerCase());
  };

  const addColumn = (table, column, type) =>
    new Promise((resolve, reject) => {
      sqliteDb.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

  try {
    const policiesHasStartDate = await hasColumn('policies', 'start_date');
    if (!policiesHasStartDate) {
      await addColumn('policies', 'start_date', 'TEXT');
    }

    const policiesHasEndDate = await hasColumn('policies', 'end_date');
    if (!policiesHasEndDate) {
      await addColumn('policies', 'end_date', 'TEXT');
    }
  } catch (error) {
    logger.warn('Schema check/migration skipped:', error?.message || error);
  }
}

/**
 * Initialize SQLite database connection to your real database
 */
function initializeSQLite() {
  return new Promise((resolve, reject) => {
    const dbPath = path.join(__dirname, '../../multi-agent-system/insurance_support.db');
    
    logger.info(`Connecting to real SQLite database at: ${dbPath}`);
    
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        logger.error('Error opening real SQLite database:', err);
        reject(err);
      } else {
        logger.info('✅ Connected to real SQLite database');
        isConnected = true;
        
        // Enable foreign keys and optimize settings
        sqliteDb.run('PRAGMA foreign_keys = ON');
        sqliteDb.run('PRAGMA busy_timeout = 5000');
        sqliteDb.run('PRAGMA journal_mode = WAL');
        
        // Test connection by running a simple query
        sqliteDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='policies'", (err, row) => {
          if (err) {
            logger.error('Error testing database:', err);
            reject(err);
          } else if (row) {
            logger.info('✅ Policies table found - database is ready');
            ensureSchema().finally(() => resolve());
          } else {
            logger.warning('⚠️ Policies table not found - database may be empty');
            resolve();
          }
        });
      }
    });
  });
}

/**
 * Execute SQL query with real database
 */
function executeQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!isConnected) {
      reject(new Error('Database not connected'));
      return;
    }
    
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) {
        logger.error('SQL Error:', { sql, params, error: err.message });
        reject(err);
      } else {
        logger.debug(`✅ Query executed successfully, returned ${rows.length} rows`);
        resolve(rows);
      }
    });
  });
}

/**
 * Execute SQL command (INSERT, UPDATE, DELETE) with real database
 */
function executeCommand(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!isConnected) {
      reject(new Error('Database not connected'));
      return;
    }
    
    sqliteDb.run(sql, params, function(err) {
      if (err) {
        logger.error('SQL Command Error:', { sql, params, error: err.message });
        reject(err);
      } else {
        logger.debug(`✅ Command executed successfully, ${this.changes} rows affected`);
        resolve({
          lastID: this.lastID,
          changes: this.changes
        });
      }
    });
  });
}

/**
 * Get database statistics
 */
async function getDatabaseStats() {
  try {
    const tables = ['customers', 'policies', 'claims', 'billing', 'payments'];
    const stats = {};
    
    for (const table of tables) {
      try {
        const rows = await executeQuery(`SELECT COUNT(*) as count FROM ${table}`);
        stats[table] = rows[0].count;
      } catch (err) {
        stats[table] = 0;
      }
    }
    
    return stats;
  } catch (error) {
    logger.error('Error getting database stats:', error);
    return {};
  }
}

/**
 * Close database connection
 */
function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (!isConnected) {
      resolve();
      return;
    }
    
    sqliteDb.close((err) => {
      if (err) {
        logger.error('Error closing database:', err);
        reject(err);
      } else {
        logger.info('✅ Database connection closed');
        isConnected = false;
        resolve();
      }
    });
  });
}

/**
 * Connect to all databases (SQLite only for now)
 */
async function connectDatabases() {
  try {
    logger.info('🔄 Initializing real database connections...');
    
    // Initialize SQLite with your real database
    await initializeSQLite();
    
    // Get database stats
    const stats = await getDatabaseStats();
    logger.info('📊 Database statistics:', stats);
    
    logger.info('✅ All database connections established successfully');
    
  } catch (error) {
    logger.error('❌ Failed to connect to databases:', error);
    throw error;
  }
}

/**
 * Get SQLite database instance
 */
function getSQLiteDb() {
  if (!isConnected) {
    throw new Error('SQLite database not initialized');
  }
  return sqliteDb;
}

module.exports = {
  connectDatabases,
  closeDatabase,
  getSQLiteDb,
  executeQuery,
  executeCommand,
  getDatabaseStats,
  isConnected: () => isConnected
};
