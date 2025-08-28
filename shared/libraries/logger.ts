import winston from 'winston';
import { Request, Response } from 'express';

export interface LogConfig {
  level: string;
  serviceName: string;
  environment: string;
  enableConsole: boolean;
  enableFile: boolean;
  enableElasticsearch: boolean;
  fileConfig?: {
    filename: string;
    maxsize: number;
    maxFiles: number;
  };
  elasticsearchConfig?: {
    node: string;
    index: string;
  };
}

export interface LogContext {
  userId?: string;
  sessionId?: string;
  requestId?: string;
  transactionId?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
  [key: string]: any;
}

export class Logger {
  private winston: winston.Logger;
  private config: LogConfig;

  constructor(config: LogConfig) {
    this.config = config;
    this.winston = this.createWinstonLogger();
  }

  private createWinstonLogger(): winston.Logger {
    const transports: winston.transport[] = [];

    // Console transport
    if (this.config.enableConsole) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
              return `${timestamp} [${this.config.serviceName}] ${level}: ${message} ${metaStr}`;
            })
          ),
        })
      );
    }

    // File transport
    if (this.config.enableFile && this.config.fileConfig) {
      transports.push(
        new winston.transports.File({
          filename: this.config.fileConfig.filename,
          maxsize: this.config.fileConfig.maxsize,
          maxFiles: this.config.fileConfig.maxFiles,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        })
      );
    }

    return winston.createLogger({
      level: this.config.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: {
        service: this.config.serviceName,
        environment: this.config.environment,
      },
      transports,
    });
  }

  info(message: string, context?: LogContext): void {
    this.winston.info(message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.winston.error(message, {
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
      ...context,
    });
  }

  warn(message: string, context?: LogContext): void {
    this.winston.warn(message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.winston.debug(message, context);
  }

  audit(action: string, context: LogContext): void {
    this.winston.info(`AUDIT: ${action}`, {
      ...context,
      audit: true,
      timestamp: new Date().toISOString(),
    });
  }

  security(event: string, context: LogContext): void {
    this.winston.warn(`SECURITY: ${event}`, {
      ...context,
      security: true,
      timestamp: new Date().toISOString(),
    });
  }

  transaction(event: string, transactionId: string, context?: LogContext): void {
    this.winston.info(`TRANSACTION: ${event}`, {
      ...context,
      transactionId,
      transaction: true,
      timestamp: new Date().toISOString(),
    });
  }

  performance(operation: string, duration: number, context?: LogContext): void {
    this.winston.info(`PERFORMANCE: ${operation}`, {
      ...context,
      duration,
      performance: true,
      timestamp: new Date().toISOString(),
    });
  }
}

export class RequestLogger {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  logRequest(req: Request, res: Response, responseTime?: number): void {
    const context: LogContext = {
      requestId: (req as any).requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip || req.connection.remoteAddress,
      responseTime,
    };

    if ((req as any).user) {
      context.userId = (req as any).user.userId;
      context.sessionId = (req as any).user.sessionId;
    }

    const message = `${req.method} ${req.url} - ${res.statusCode}`;
    
    if (res.statusCode >= 400) {
      this.logger.error(message, undefined, context);
    } else {
      this.logger.info(message, context);
    }
  }

  middleware() {
    return (req: Request, res: Response, next: any) => {
      const start = Date.now();
      (req as any).requestId = this.generateRequestId();

      res.on('finish', () => {
        const duration = Date.now() - start;
        this.logRequest(req, res, duration);
      });

      next();
    };
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
}

export class AuditLogger {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  logUserAction(userId: string, action: string, details: any): void {
    this.logger.audit(`User action: ${action}`, {
      userId,
      action,
      details,
    });
  }

  logAdminAction(adminId: string, action: string, targetUserId?: string, details?: any): void {
    this.logger.audit(`Admin action: ${action}`, {
      adminId,
      action,
      targetUserId,
      details,
    });
  }

  logSystemAction(action: string, details: any): void {
    this.logger.audit(`System action: ${action}`, {
      action,
      details,
      system: true,
    });
  }

  logSecurityEvent(event: string, userId?: string, details?: any): void {
    this.logger.security(event, {
      userId,
      event,
      details,
    });
  }

  logTransactionEvent(transactionId: string, event: string, userId?: string, details?: any): void {
    this.logger.transaction(event, transactionId, {
      userId,
      event,
      details,
    });
  }
}

export const getDefaultLogConfig = (serviceName: string): LogConfig => {
  return {
    level: process.env.LOG_LEVEL || 'info',
    serviceName,
    environment: process.env.NODE_ENV || 'development',
    enableConsole: process.env.LOG_CONSOLE !== 'false',
    enableFile: process.env.LOG_FILE === 'true',
    enableElasticsearch: process.env.LOG_ELASTICSEARCH === 'true',
    fileConfig: process.env.LOG_FILE === 'true' ? {
      filename: process.env.LOG_FILE_PATH || `logs/${serviceName}.log`,
      maxsize: parseInt(process.env.LOG_FILE_MAX_SIZE || '10485760'), // 10MB
      maxFiles: parseInt(process.env.LOG_FILE_MAX_FILES || '5'),
    } : undefined,
    elasticsearchConfig: process.env.LOG_ELASTICSEARCH === 'true' ? {
      node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      index: process.env.LOG_ELASTICSEARCH_INDEX || 'swiftpayme-logs',
    } : undefined,
  };
};

export const createLogger = (serviceName: string, config?: Partial<LogConfig>): Logger => {
  const defaultConfig = getDefaultLogConfig(serviceName);
  const finalConfig = { ...defaultConfig, ...config };
  return new Logger(finalConfig);
};

