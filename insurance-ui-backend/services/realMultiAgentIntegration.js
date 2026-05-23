const axios = require('axios');
const logger = require('../utils/logger');
const { spawn } = require('child_process');
const path = require('path');

/**
 * Real Multi-Agent System Integration Service
 * This service connects to the Python multi-agent system API
 */
class MultiAgentIntegrationService {
  constructor() {
    this.pythonApiUrl = process.env.PYTHON_API_URL || 'http://127.0.0.1:8002';
    this.isInitialized = false;
    this.messageQueue = [];
    this.responseHandlers = new Map();
    this.pythonProcess = null;
  }

  getPythonPort() {
    try {
      const u = new URL(this.pythonApiUrl);
      return Number(u.port || 80);
    } catch {
      return 8002;
    }
  }

  /**
   * Initialize the multi-agent system integration
   */
  async initialize() {
    try {
      logger.info('Initializing Real Multi-Agent System Integration...');
      
      // Test connection to Python API
      const ok = await this.testPythonApiConnection();
      if (!ok) {
        await this.startPythonApiProcess();
        await this.waitForPythonApiHealthy();
        await this.testPythonApiConnection(true);
      }
      
      this.isInitialized = true;
      logger.info('Real Multi-Agent System Integration initialized successfully');
      
    } catch (error) {
      this.isInitialized = false;
      logger.error('Failed to initialize Real Multi-Agent System Integration:', error);
    }
  }

  /**
   * Test connection to Python API
   */
  async testPythonApiConnection(throwOnFail = false) {
    try {
      const response = await axios.get(`${this.pythonApiUrl}/health`);
      if (response.data.status === 'healthy') {
        logger.info('Python API connection successful');
        return true;
      } else {
        throw new Error('Python API not healthy');
      }
    } catch (error) {
      logger.error('Failed to connect to Python API:', error);
      if (throwOnFail) {
        throw new Error(`Python multi-agent system not available. Please ensure the Python API server is running on port ${this.getPythonPort()}.`);
      }
      return false;
    }
  }

  async startPythonApiProcess() {
    if (this.pythonProcess) {
      return;
    }

    const pythonExecutable = process.env.PYTHON_EXECUTABLE || 'python';
    const multiAgentDir = path.resolve(__dirname, '..', '..', 'multi-agent-system');
    const apiServerPath = path.resolve(multiAgentDir, 'api_server.py');

    logger.info(`Starting Python API process: ${pythonExecutable} ${apiServerPath}`);

    const env = {
      ...process.env,
      PORT: String(this.getPythonPort()),
    };

    const child = spawn(pythonExecutable, [apiServerPath], {
      cwd: multiAgentDir,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data) => {
      const text = String(data || '').trim();
      if (text) logger.info(text);
    });

    child.stderr.on('data', (data) => {
      const text = String(data || '').trim();
      if (text) logger.error(text);
    });

    child.on('exit', (code, signal) => {
      logger.error(`Python API process exited (code=${code}, signal=${signal})`);
      this.pythonProcess = null;
      this.isInitialized = false;
    });

    this.pythonProcess = child;
  }

  async waitForPythonApiHealthy() {
    const started = Date.now();
    const timeoutMs = Number(process.env.PYTHON_API_STARTUP_TIMEOUT_MS || 60000);

    while (Date.now() - started < timeoutMs) {
      try {
        const resp = await axios.get(`${this.pythonApiUrl}/health`, { timeout: 2000 });
        if (resp?.data?.status === 'healthy') {
          return;
        }
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error('Timed out waiting for Python API to become healthy');
  }

  /**
   * Process user query through the real multi-agent system
   */
  async processQuery(query, context = {}) {
    if (!this.isInitialized) {
      await this.initialize();
      if (!this.isInitialized) {
        throw new Error('Multi-agent system not initialized');
      }
    }

    try {
      logger.info(`Sending query to real multi-agent system: ${query}`);

      const conversationHistory = Array.isArray(context.conversationHistory)
        ? context.conversationHistory
            .map((m) => {
              const role = m.type === 'user' ? 'User' : 'Assistant';
              const content = String(m.content || '').replace(/\s+/g, ' ').trim();
              return content ? `${role}: ${content}` : null;
            })
            .filter(Boolean)
            .join('\n')
        : (context.conversationHistory || '');
      
      const response = await axios.post(`${this.pythonApiUrl}/api/process-query`, {
        query: query || '', // Ensure query is at least an empty string
        session_id: context.sessionId || context.session_id || null,
        customer_id: context.customerId,
        policy_number: context.policyNumber,
        conversation_history: conversationHistory,
        image: context.image || null // Pass image data to Python
      }, {
        timeout: 60000, // Increased timeout for image processing
        maxBodyLength: 10 * 1024 * 1024, // 10MB limit
        maxContentLength: 10 * 1024 * 1024 // 10MB limit
      });

      if (response.data.success) {
        const result = response.data.data;
        logger.info(`Received response from ${result.agent}: ${result.response.substring(0, 100)}...`);
        
        return {
          agent: result.agent,
          response: result.response,
          next_agent: result.next_agent || null,
          status: result.status || null,
          confidence: result.confidence ?? null,
          metadata: result.metadata || {},
          timestamp: result.timestamp
        };
      } else {
        throw new Error(response.data.error || 'Unknown error from multi-agent system');
      }
      
    } catch (error) {
      logger.error('Error calling multi-agent system:', error);
      
      if (error.code === 'ECONNREFUSED') {
        this.isInitialized = false;
        this.pythonProcess = null;
        throw new Error('Multi-agent system is not running. Python API is unavailable.');
      } else if (error.response) {
        throw new Error(`Multi-agent system error: ${error.response.data.error || error.response.statusText}`);
      } else {
        throw new Error(`Failed to process query: ${error.message}`);
      }
    }
  }

  /**
   * Get system status from Python API
   */
  async getSystemStatus() {
    try {
      const response = await axios.get(`${this.pythonApiUrl}/api/agent-status`);
      if (response.data) {
        return {
          initialized: this.isInitialized,
          pythonApiConnected: true,
          agents: response.data.agents,
          databaseConnected: response.data.database_connected,
          timestamp: response.data.timestamp
        };
      }
    } catch (error) {
      logger.error('Failed to get system status:', error);
      return {
        initialized: this.isInitialized,
        pythonApiConnected: false,
        agents: {},
        databaseConnected: false,
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  /**
   * Get policy details from Python API
   */
  async getPolicyDetails(policyNumber) {
    try {
      const response = await axios.get(`${this.pythonApiUrl}/api/policy/${policyNumber}`);
      if (response.data.success) {
        return response.data.data;
      } else {
        throw new Error(response.data.error);
      }
    } catch (error) {
      logger.error('Error fetching policy details:', error);
      throw error;
    }
  }

  /**
   * Get claims information from Python API
   */
  async getClaims(claimId = null, policyNumber = null) {
    try {
      const params = {};
      if (claimId) params.claim_id = claimId;
      if (policyNumber) params.policy_number = policyNumber;
      
      const response = await axios.get(`${this.pythonApiUrl}/api/claims`, { params });
      if (response.data.success) {
        return response.data.data;
      } else {
        throw new Error(response.data.error);
      }
    } catch (error) {
      logger.error('Error fetching claims:', error);
      throw error;
    }
  }

  /**
   * Get billing information from Python API
   */
  async getBilling(policyNumber = null, customerId = null) {
    try {
      const params = {};
      if (policyNumber) params.policy_number = policyNumber;
      if (customerId) params.customer_id = customerId;
      
      const response = await axios.get(`${this.pythonApiUrl}/api/billing`, { params });
      if (response.data.success) {
        return response.data.data;
      } else {
        throw new Error(response.data.error);
      }
    } catch (error) {
      logger.error('Error fetching billing:', error);
      throw error;
    }
  }

  /**
   * Get proactive notifications from Python API
   */
  async getProactiveNotifications(customerId) {
    try {
      const response = await axios.get(`${this.pythonApiUrl}/api/notifications/proactive`, {
        params: { customer_id: customerId }
      });
      if (response.data.success) {
        return response.data.data;
      } else {
        throw new Error(response.data.error);
      }
    } catch (error) {
      logger.error('Error fetching proactive notifications:', error);
      return [];
    }
  }

  /**
   * Get system status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      pythonApiUrl: this.pythonApiUrl,
      pythonApiConnected: this.isInitialized,
      mode: 'real', // Indicate we're using real system
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    logger.info('Cleaning up Real Multi-Agent System Integration...');
    this.isInitialized = false;
    if (this.pythonProcess) {
      try {
        this.pythonProcess.kill();
      } catch {
        // ignore
      }
      this.pythonProcess = null;
    }
    logger.info('Real Multi-Agent System Integration cleanup completed');
  }
}

// Create singleton instance
const multiAgentService = new MultiAgentIntegrationService();

module.exports = multiAgentService;
