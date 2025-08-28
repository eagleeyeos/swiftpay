import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { createProxyMiddleware } from 'http-proxy-middleware';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import dotenv from 'dotenv';

import { DatabaseManager, getDefaultDatabaseConfig } from '../../shared/config/database';
import { AuthenticationService, AuthorizationService, getDefaultAuthConfig } from '../../shared/libraries/auth';
import { Logger, RequestLogger, AuditLogger, getDefaultLogConfig } from '../../shared/libraries/logger';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { metricsRoutes } from './routes/metrics';
import { errorHandler } from './middleware/errorHandler';
import { requestValidator } from './middleware/requestValidator';
import { securityMiddleware } from './middleware/security';
import { ProxyService } from './services/proxyService';
import { MetricsService } from './services/metricsService';
import { CacheService } from './services/cacheService';

// Load environment variables
dotenv.config();

class APIGateway {
  private app: express.Application;
  private logger: Logger;
  private requestLogger: RequestLogger;
  private auditLogger: AuditLogger;
  private dbManager: DatabaseManager;
  private authService: AuthenticationService;
  private authzService: AuthorizationService;
  private proxyService: ProxyService;
  private metricsService: MetricsService;
  private cacheService: CacheService;
  private port: number;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '8000');
    
    // Initialize services
    this.logger = new Logger(getDefaultLogConfig('api-gateway'));
    this.requestLogger = new RequestLogger(this.logger);
    this.auditLogger = new AuditLogger(this.logger);
    this.dbManager = new DatabaseManager(getDefaultDatabaseConfig());
    this.authService = new AuthenticationService(getDefaultAuthConfig());
    this.authzService = new AuthorizationService();
    this.proxyService = new ProxyService(this.logger);
    this.metricsService = new MetricsService();
    this.cacheService = new CacheService();
  }

  async initialize(): Promise<void> {
    try {
      // Initialize database connections
      await this.dbManager.initializePostgres();
      await this.dbManager.initializeRedis();
      
      // Initialize cache service
      await this.cacheService.initialize(this.dbManager.getRedisClient());

      // Setup middleware
      this.setupMiddleware();
      
      // Setup routes
      this.setupRoutes();
      
      // Setup proxy routes
      this.setupProxyRoutes();
      
      // Setup error handling
      this.setupErrorHandling();

      this.logger.info('API Gateway initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize API Gateway', error as Error);
      throw error;
    }
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
    }));

    // Compression
    this.app.use(compression());

    // Request logging
    this.app.use(morgan('combined', {
      stream: {
        write: (message: string) => {
          this.logger.info(message.trim());
        }
      }
    }));

    // Request ID and logging
    this.app.use(this.requestLogger.middleware());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX || '1000'), // limit each IP to 1000 requests per windowMs
      message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900000') / 1000),
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

    this.app.use('/api/', limiter);

    // Slow down repeated requests
    const speedLimiter = slowDown({
      windowMs: parseInt(process.env.SLOW_DOWN_WINDOW || '900000'), // 15 minutes
      delayAfter: parseInt(process.env.SLOW_DOWN_DELAY_AFTER || '100'), // allow 100 requests per windowMs without delay
      delayMs: parseInt(process.env.SLOW_DOWN_DELAY_MS || '500'), // add 500ms delay per request after delayAfter
      maxDelayMs: parseInt(process.env.SLOW_DOWN_MAX_DELAY || '20000'), // max delay of 20 seconds
    });

    this.app.use('/api/', speedLimiter);

    // Custom security middleware
    this.app.use(securityMiddleware());

    // Request validation middleware
    this.app.use(requestValidator());

    // Metrics collection
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        this.metricsService.recordRequest(req.method, req.path, res.statusCode, duration);
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.use('/health', healthRoutes);

    // Metrics endpoint
    this.app.use('/metrics', metricsRoutes(this.metricsService));

    // Authentication routes
    this.app.use('/auth', authRoutes(this.authService, this.authzService, this.auditLogger, this.cacheService));

    // API documentation
    if (process.env.NODE_ENV !== 'production') {
      try {
        const swaggerDocument = YAML.load('./docs/api.yaml');
        this.app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
      } catch (error) {
        this.logger.warn('Could not load API documentation', { error: (error as Error).message });
      }
    }

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        service: 'SwiftPayme API Gateway',
        version: '1.0.0',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          metrics: '/metrics',
          auth: '/auth',
          docs: '/docs',
          api: '/api/v1',
        },
      });
    });
  }

  private setupProxyRoutes(): void {
    const services = [
      { path: '/api/v1/users', target: `http://localhost:${process.env.USER_SERVICE_PORT || 8001}`, service: 'user-service' },
      { path: '/api/v1/transactions', target: `http://localhost:${process.env.TRANSACTION_SERVICE_PORT || 8002}`, service: 'transaction-service' },
      { path: '/api/v1/billing', target: `http://localhost:${process.env.BILLING_SERVICE_PORT || 8003}`, service: 'billing-service' },
      { path: '/api/v1/ledger', target: `http://localhost:${process.env.LEDGER_SERVICE_PORT || 8004}`, service: 'ledger-service' },
      { path: '/api/v1/tokens', target: `http://localhost:${process.env.TOKENIZATION_SERVICE_PORT || 8005}`, service: 'tokenization-service' },
      { path: '/api/v1/crypto', target: `http://localhost:${process.env.CRYPTO_SERVICE_PORT || 8006}`, service: 'crypto-service' },
      { path: '/api/v1/currency', target: `http://localhost:${process.env.CURRENCY_CONVERSION_PORT || 8007}`, service: 'currency-conversion' },
      { path: '/api/v1/api-keys', target: `http://localhost:${process.env.API_SERVICE_PORT || 8008}`, service: 'api-service' },
      { path: '/api/v1/admin', target: `http://localhost:${process.env.ADMIN_SERVICE_PORT || 8009}`, service: 'admin-service' },
    ];

    services.forEach(({ path, target, service }) => {
      this.app.use(path, createProxyMiddleware({
        target,
        changeOrigin: true,
        pathRewrite: {
          [`^${path}`]: '/api/v1',
        },
        onProxyReq: (proxyReq, req, res) => {
          // Add service identification header
          proxyReq.setHeader('X-Gateway-Service', service);
          proxyReq.setHeader('X-Request-ID', (req as any).requestId);
          
          // Forward user context if available
          if ((req as any).user) {
            proxyReq.setHeader('X-User-ID', (req as any).user.userId);
            proxyReq.setHeader('X-User-Roles', JSON.stringify((req as any).user.roles));
          }

          this.logger.debug(`Proxying request to ${service}`, {
            path: req.path,
            method: req.method,
            target,
            requestId: (req as any).requestId,
          });
        },
        onProxyRes: (proxyRes, req, res) => {
          this.metricsService.recordProxyRequest(service, proxyRes.statusCode || 0);
        },
        onError: (err, req, res) => {
          this.logger.error(`Proxy error for ${service}`, err, {
            path: req.path,
            method: req.method,
            target,
            requestId: (req as any).requestId,
          });

          this.metricsService.recordProxyError(service);

          if (!res.headersSent) {
            res.status(503).json({
              error: 'Service temporarily unavailable',
              service,
              requestId: (req as any).requestId,
            });
          }
        },
      }));
    });
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
      });
    });

    // Global error handler
    this.app.use(errorHandler(this.logger));
  }

  async start(): Promise<void> {
    try {
      await this.initialize();

      this.app.listen(this.port, '0.0.0.0', () => {
        this.logger.info(`API Gateway started on port ${this.port}`, {
          port: this.port,
          environment: process.env.NODE_ENV || 'development',
          pid: process.pid,
        });
      });

      // Graceful shutdown
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());

    } catch (error) {
      this.logger.error('Failed to start API Gateway', error as Error);
      process.exit(1);
    }
  }

  private async shutdown(): Promise<void> {
    this.logger.info('Shutting down API Gateway...');

    try {
      await this.dbManager.closeConnections();
      this.logger.info('API Gateway shutdown complete');
      process.exit(0);
    } catch (error) {
      this.logger.error('Error during shutdown', error as Error);
      process.exit(1);
    }
  }
}

// Start the API Gateway
const gateway = new APIGateway();
gateway.start().catch((error) => {
  console.error('Failed to start API Gateway:', error);
  process.exit(1);
});

export default APIGateway;

