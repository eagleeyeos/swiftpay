import { Request, Response, NextFunction } from 'express';
import { Logger } from '../../../shared/libraries/logger';

export interface APIError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

export const errorHandler = (logger: Logger) => {
  return (error: APIError, req: Request, res: Response, next: NextFunction) => {
    // Log the error
    logger.error('API Error', error, {
      requestId: (req as any).requestId,
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip || req.connection.remoteAddress,
      userId: (req as any).user?.userId,
    });

    // Default error response
    let statusCode = error.statusCode || 500;
    let message = error.message || 'Internal Server Error';
    let code = error.code || 'INTERNAL_ERROR';

    // Handle specific error types
    if (error.name === 'ValidationError') {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
    } else if (error.name === 'UnauthorizedError' || error.name === 'JsonWebTokenError') {
      statusCode = 401;
      code = 'UNAUTHORIZED';
      message = 'Authentication required';
    } else if (error.name === 'ForbiddenError') {
      statusCode = 403;
      code = 'FORBIDDEN';
      message = 'Insufficient permissions';
    } else if (error.name === 'NotFoundError') {
      statusCode = 404;
      code = 'NOT_FOUND';
      message = 'Resource not found';
    } else if (error.name === 'ConflictError') {
      statusCode = 409;
      code = 'CONFLICT';
      message = 'Resource conflict';
    }

    // Prepare error response
    const errorResponse: any = {
      success: false,
      error: {
        code,
        message,
        timestamp: new Date().toISOString(),
        requestId: (req as any).requestId,
      },
    };

    // Include error details in development mode
    if (process.env.NODE_ENV === 'development') {
      errorResponse.error.details = error.details;
      errorResponse.error.stack = error.stack;
    }

    // Include validation details if available
    if (error.details && statusCode === 400) {
      errorResponse.error.validation = error.details;
    }

    res.status(statusCode).json(errorResponse);
  };
};

