const { executeQuery, executeCommand } = require('../config/realDatabase');

const DEFAULT_SETTINGS = {
  profile: {
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    state: null,
  },
  notifications: {
    inApp: true,
    email: false,
    sms: false,
  },
  chat: {
    showTypingIndicator: true,
    autoScroll: true,
    maxHistoryMessages: 50,
  },
  privacy: {
    analytics: true,
    dataCollection: false,
  },
  integrations: {
    multiAgentEnabled: true,
    faqEnabled: true,
  },
  system: {
    themeMode: 'light',
    locale: 'en-US',
    timeZone: null,
  },
};

async function initializeSettingsStorage() {
  await executeCommand(`
    CREATE TABLE IF NOT EXISTS customer_settings (
      customer_id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await executeCommand(`CREATE INDEX IF NOT EXISTS idx_customer_settings_updated_at ON customer_settings(updated_at)`);
}

async function getSettings(customerId) {
  const rows = await executeQuery(
    `SELECT customer_id as customerId, settings_json as settingsJson, created_at as createdAt, updated_at as updatedAt
     FROM customer_settings
     WHERE customer_id = ?`,
    [customerId]
  );

  if (!rows.length) {
    return {
      customerId,
      settings: DEFAULT_SETTINGS,
      createdAt: null,
      updatedAt: null,
    };
  }

  const row = rows[0];
  return {
    customerId: row.customerId,
    settings: safeJsonParse(row.settingsJson) || DEFAULT_SETTINGS,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function upsertSettings(customerId, partialSettings) {
  const now = new Date().toISOString();

  const existing = await executeQuery(
    `SELECT settings_json as settingsJson FROM customer_settings WHERE customer_id = ?`,
    [customerId]
  );

  const current = existing.length ? safeJsonParse(existing[0].settingsJson) || DEFAULT_SETTINGS : DEFAULT_SETTINGS;
  const merged = deepMerge(current, partialSettings || {});

  if (!existing.length) {
    await executeCommand(
      `INSERT INTO customer_settings (customer_id, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [customerId, JSON.stringify(merged), now, now]
    );
  } else {
    await executeCommand(
      `UPDATE customer_settings SET settings_json = ?, updated_at = ? WHERE customer_id = ?`,
      [JSON.stringify(merged), now, customerId]
    );
  }

  return getSettings(customerId);
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  const out = { ...(target || {}) };

  Object.keys(source).forEach((key) => {
    const sVal = source[key];
    const tVal = out[key];

    if (sVal && typeof sVal === 'object' && !Array.isArray(sVal)) {
      out[key] = deepMerge(tVal && typeof tVal === 'object' ? tVal : {}, sVal);
    } else {
      out[key] = sVal;
    }
  });

  return out;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

module.exports = {
  initializeSettingsStorage,
  getSettings,
  upsertSettings,
  DEFAULT_SETTINGS,
};

