import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { DatabaseManager, getDefaultDatabaseConfig } from '../../shared/config/database';
import { AuthenticationService, getDefaultAuthConfig } from '../../shared/libraries/auth';
import { Logger, RequestLogger, AuditLogger, getDefaultLogConfig } from '../../shared/libraries/logger';

import { accountRoutes } from './routes/accountRoutes';
import { balanceRoutes } from './routes/balanceRoutes';
import { profileRoutes } from './routes/profileRoutes';
import { healthRoutes } from './routes/healthRoutes';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/authMiddleware';

import { AccountService } from './services/accountService';
import { BalanceService } from './services/balanceService';
import { ProfileService } from './services/profileService';
import { NotificationService } from './services/notificationService';

// Load environment variables
dotenv.config();

class AccountServiceApp {
  private app: express.Application;
  private logger: Logger;
  private requestLogger: RequestLogger;
  private auditLogger: AuditLogger;
  private dbManager: DatabaseManager;
  private authService: AuthenticationService;
  private accountService: AccountService;
  private balanceService: BalanceService;
  private profileService: ProfileService;
  private notificationService: NotificationService;
  private port: number;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '8010');
    
    // Initialize services
    this.logger = new Logger(getDefaultLogConfig('account-service'));
    this.requestLogger = new RequestLogger(this.logger);
    this.auditLogger = new AuditLogger(this.logger);
    this.dbManager = new DatabaseManager(getDefaultDatabaseConfig());
    this.authService = new AuthenticationService(getDefaultAuthConfig());
    
    // Initialize business services
    this.accountService = new AccountService(this.dbManager, this.logger, this.auditLogger);
    this.balanceService = new BalanceService(this.dbManager, this.logger, this.auditLogger);
    this.profileService = new ProfileService(this.dbManager, this.logger, this.auditLogger);
    this.notificationService = new NotificationService(this.logger);
  }

  async initialize(): Promise<void> {
    try {
      // Initialize database connections
      await this.dbManager.initializePostgres();
      await this.dbManager.initializeRedis();
      await this.dbManager.initializeMongoDB();

      // Initialize business services
      await this.accountService.initialize();
      await this.balanceService.initialize();
      await this.profileService.initialize();
      await this.notificationService.initialize();

      // Setup middleware
      this.setupMiddleware();
      
      // Setup routes
      this.setupRoutes();
      
      // Setup error handling
      this.setupErrorHandling();

      this.logger.info('Account Service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Account Service', error as Error);
      throw error;
    }
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    
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

    // Authentication middleware
    this.app.use('/api/v1', authMiddleware(this.authService, this.logger));
  }

  private setupRoutes(): void {
    // Health check
    this.app.use('/health', healthRoutes);

    // API routes
    this.app.use('/api/v1/accounts', accountRoutes(
      this.accountService,
      this.balanceService,
      this.auditLogger
    ));

    this.app.use('/api/v1/balances', balanceRoutes(
      this.balanceService,
      this.accountService,
      this.auditLogger
    ));

    this.app.use('/api/v1/profiles', profileRoutes(
      this.profileService,
      this.accountService,
      this.auditLogger
    ));

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        service: 'SwiftPayme Account Service',
        version: '1.0.0',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          accounts: '/api/v1/accounts',
          balances: '/api/v1/balances',
          profiles: '/api/v1/profiles',
        },
      });
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
        this.logger.info(`Account Service started on port ${this.port}`, {
          port: this.port,
          environment: process.env.NODE_ENV || 'development',
          pid: process.pid,
        });
      });

      // Graceful shutdown
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());

    } catch (error) {
      this.logger.error('Failed to start Account Service', error as Error);
      process.exit(1);
    }
  }

  private async shutdown(): Promise<void> {
    this.logger.info('Shutting down Account Service...');

    try {
      await this.dbManager.closeConnections();
      this.logger.info('Account Service shutdown complete');
      process.exit(0);
    } catch (error) {
      this.logger.error('Error during shutdown', error as Error);
      process.exit(1);
    }
  }
}

// Start the Account Service
const accountService = new AccountServiceApp();
accountService.start().catch((error) => {
  console.error('Failed to start Account Service:', error);
  process.exit(1);
});

export default AccountServiceApp;

