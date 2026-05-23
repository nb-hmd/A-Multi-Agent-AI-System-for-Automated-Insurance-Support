const { spawn } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Python Multi-Agent System Integration Service
 * This service bridges the Python multi-agent system with the Node.js backend
 */
class MultiAgentIntegrationService {
  constructor() {
    this.pythonProcess = null;
    this.isInitialized = false;
    this.messageQueue = [];
    this.responseHandlers = new Map();
  }

  /**
   * Initialize the Python multi-agent system
   */
  async initialize() {
    try {
      logger.info('Initializing Multi-Agent System Integration...');
      
      // Check if Python is available
      await this.verifyPythonEnvironment();
      
      // Initialize the multi-agent system
      await this.initializeMultiAgentSystem();
      
      this.isInitialized = true;
      logger.info('Multi-Agent System Integration initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Multi-Agent System Integration:', error);
      // Create mock service for development
      this.createMockService();
      this.isInitialized = true;
      logger.info('Using mock multi-agent service for development');
    }
  }

  /**
   * Create mock service for development
   */
  createMockService() {
    this.pythonProcess = {
      stdin: {
        write: (data) => {
          logger.debug('Mock Python process received:', data);
          // Simulate response
          setTimeout(() => {
            const mockResponse = this.generateMockResponse(data);
            this.handleResponse(mockResponse);
          }, 1000 + Math.random() * 2000);
        }
      },
      kill: () => {
        logger.info('Mock Python process terminated');
      }
    };
  }

  /**
   * Generate mock response for development
   */
  generateMockResponse(requestData) {
    try {
      const request = JSON.parse(requestData);
      const { query, context } = request;
      
      // Mock agent responses based on query content
      const queryLower = query.toLowerCase();
      let response, agentType;
      
      if (queryLower.includes('policy') || queryLower.includes('coverage')) {
        agentType = 'policy_agent';
        response = "I'll help you with your policy inquiry. Based on your policy POL001, you have comprehensive auto coverage with a $500 deductible. Would you like to know more about your specific coverage details?";
      } else if (queryLower.includes('billing') || queryLower.includes('payment') || queryLower.includes('premium')) {
        agentType = 'billing_agent';
        response = "I'll help you with your billing question. Your current premium is $1,200 annually, billed monthly at $100. Your next payment is due on the 15th. Would you like to set up automatic payments?";
      } else if (queryLower.includes('claim')) {
        agentType = 'claims_agent';
        response = "I'll help you with your claim. I can see you have one open claim (CLM001) from January 15th regarding a collision. The estimated loss is $5,000 and it's currently being processed. Would you like an update on the status?";
      } else if (queryLower.includes('help') || queryLower.includes('what') || queryLower.includes('how')) {
        agentType = 'general_help_agent';
        response = "I'll help answer your general insurance question. Insurance provides financial protection against unexpected events. Would you like to know about specific types of coverage or have a particular question?";
      } else {
        agentType = 'supervisor_agent';
        response = "I understand you're asking about insurance. Let me connect you with the right specialist who can provide detailed assistance with your specific inquiry.";
      }
      
      return {
        ...request,
        agent: agentType,
        response: response,
        next_agent: null,
        status: 'completed'
      };
      
    } catch (error) {
      return {
        requestId: 'mock_' + Date.now(),
        error: 'Mock response generation failed',
        status: 'error'
      };
    }
  }

  /**
   * Verify Python environment and dependencies
   */
  async verifyPythonEnvironment() {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn('python', ['--version']);
      
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          logger.info('Python environment verified');
          resolve();
        } else {
          reject(new Error('Python not found or not working properly'));
        }
      });

      pythonProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Initialize the multi-agent system
   */
  async initializeMultiAgentSystem() {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../../multi-agent-system/multi-agent system.ipynb');
      
      // For development, we'll use the mock service
      this.createMockService();
      resolve();
    });
  }

  /**
   * Process user query through the multi-agent system
   */
  async processQuery(query, context = {}) {
    if (!this.isInitialized) {
      throw new Error('Multi-agent system not initialized');
    }

    return new Promise((resolve, reject) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Set up response handler
      this.responseHandlers.set(requestId, {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.responseHandlers.delete(requestId);
          reject(new Error('Multi-agent system timeout'));
        }, 15000), // 15 second timeout
      });

      // Send request to Python process
      const request = {
        query,
        context,
        requestId,
        timestamp: new Date().toISOString(),
      };

      try {
        this.pythonProcess.stdin.write(JSON.stringify(request) + '\n');
        logger.info(`Sent query to multi-agent system: ${requestId}`);
      } catch (error) {
        this.responseHandlers.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * Handle response from Python process
   */
  handleResponse(response) {
    const { requestId } = response;
    
    if (requestId && this.responseHandlers.has(requestId)) {
      const handler = this.responseHandlers.get(requestId);
      clearTimeout(handler.timeout);
      
      if (response.error) {
        handler.reject(new Error(response.error));
      } else {
        handler.resolve(response);
      }
      
      this.responseHandlers.delete(requestId);
    } else {
      // Handle system messages or broadcasts
      logger.debug('Received system message:', response);
    }
  }

  /**
   * Get system status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      processRunning: this.pythonProcess !== null,
      pendingRequests: this.responseHandlers.size,
      messageQueueLength: this.messageQueue.length,
      mode: 'mock' // Indicate we're using mock service
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    logger.info('Cleaning up Multi-Agent System Integration...');
    
    // Reject all pending requests
    this.responseHandlers.forEach((handler) => {
      clearTimeout(handler.timeout);
      handler.reject(new Error('System shutting down'));
    });
    this.responseHandlers.clear();
    
    // Terminate Python process
    if (this.pythonProcess && this.pythonProcess.kill) {
      try {
        this.pythonProcess.kill('SIGTERM');
      } catch (error) {
        logger.error('Error terminating Python process:', error);
      }
    }
    
    this.isInitialized = false;
    logger.info('Multi-Agent System Integration cleanup completed');
  }
}

// Create singleton instance
const multiAgentService = new MultiAgentIntegrationService();

module.exports = multiAgentService;