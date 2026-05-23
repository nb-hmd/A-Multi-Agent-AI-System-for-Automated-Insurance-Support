const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const logger = require('./utils/logger');
const { connectDatabases } = require('./config/realDatabase');
const { initializeChatStorage } = require('./services/chatStorage');
const { initializeSettingsStorage } = require('./services/settingsStorage');
const { setupSocketHandlers } = require('./socket/handlers');
const multiAgentService = require('./services/realMultiAgentIntegration');

// Import routes
const chatRoutes = require('./routes/chat');
const policyRoutes = require('./routes/policy');
const billingRoutes = require('./routes/billing');
const claimsRoutes = require('./routes/claims');
const analyticsRoutes = require('./routes/analytics');
const { router: authRoutes } = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const documentsRoutes = require('./routes/documents');
const notificationsRoutes = require('./routes/notifications');

const app = express();
const server = createServer(app);
const parseOrigins = (value) =>
  String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const defaultDevOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const corsOriginList = parseOrigins(process.env.CORS_ORIGIN);
const socketCorsOriginList = parseOrigins(process.env.SOCKET_CORS_ORIGIN);
const allowedOrigins = corsOriginList.length ? corsOriginList : defaultDevOrigins;
const allowedSocketOrigins = socketCorsOriginList.length ? socketCorsOriginList : allowedOrigins;
const isDev = (process.env.NODE_ENV || 'development') !== 'production';

const originAllowed = (origin) => {
  if (!origin) return true;
  if (origin === 'null') return isDev;
  if (isDev) {
    if (origin.startsWith('http://localhost:')) return true;
    if (origin.startsWith('http://127.0.0.1:')) return true;
  }
  return allowedOrigins.includes(origin);
};

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => cb(null, isDev ? originAllowed(origin) : allowedSocketOrigins.includes(origin)),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: JSON.parse(process.env.SOCKET_TRANSPORTS || '["websocket", "polling"]')
});

const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginResourcePolicy: isDev ? false : undefined,
  crossOriginOpenerPolicy: isDev ? false : undefined,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: isDev ? 100000 : (parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// CORS configuration
app.use(cors({
  origin: (origin, cb) => cb(null, originAllowed(origin)),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url} - ${req.ip}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    multiAgentStatus: multiAgentService.getStatus()
  });
});

// Multi-agent system status endpoint
app.get('/api/multi-agent/status', (req, res) => {
  res.json({
    success: true,
    data: multiAgentService.getStatus()
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/policy', policyRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/claims', claimsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/notifications', notificationsRoutes);

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`, { stack: err.stack, url: req.url });
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message,
      details: err.details
    });
  }
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }
  
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`
  });
});

// Socket.IO setup
setupSocketHandlers(io);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  try {
    multiAgentService.cleanup();
  } catch {}
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  try {
    multiAgentService.cleanup();
  } catch {}
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

// Start server
async function startServer() {
  try {
    // Connect to databases
    await connectDatabases();
    logger.info('Database connections established');

    await initializeChatStorage();
    logger.info('Chat storage initialized');

    await initializeSettingsStorage();
    logger.info('Settings storage initialized');
    
    // Initialize multi-agent system
    await multiAgentService.initialize();
    logger.info('Multi-agent system initialization attempted');
    
    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`🚀 Insurance UI Backend running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV}`);
      logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
      logger.info(`🤖 Multi-agent status: http://localhost:${PORT}/api/multi-agent/status`);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server, io };
