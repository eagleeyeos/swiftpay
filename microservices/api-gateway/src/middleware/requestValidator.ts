import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

export const requestValidator = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip validation for certain paths
    const skipPaths = ['/health', '/metrics', '/docs'];
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Validate common request structure
    const requestSchema = Joi.object({
      body: Joi.object().unknown(true),
      query: Joi.object().unknown(true),
      params: Joi.object().unknown(true),
      headers: Joi.object().unknown(true),
    }).unknown(true);

    const { error } = requestSchema.validate(req);
    if (error) {
      return res.status(400).json({
        error: 'Request Validation Failed',
        message: error.details[0].message,
        requestId: (req as any).requestId,
      });
    }

    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }

    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query);
    }

    next();
  };
};

export const validateSchema = (schema: Joi.ObjectSchema, target: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = req[target];
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        error: 'Validation Failed',
        message: 'Request validation failed',
        details: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value,
        })),
        requestId: (req as any).requestId,
      });
    }

    // Replace the original data with validated and sanitized data
    (req as any)[target] = value;
    next();
  };
};

// Common validation schemas
export const commonSchemas = {
  uuid: Joi.string().uuid().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required()
    .messages({
      'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
    }),
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  amount: Joi.number().positive().precision(8).required(),
  currency: Joi.string().length(3).uppercase().required(),
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().valid('asc', 'desc').default('desc'),
    sortBy: Joi.string().default('createdAt'),
  },
  dateRange: {
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().greater(Joi.ref('startDate')),
  },
};

// Authentication schemas
export const authSchemas = {
  login: Joi.object({
    email: commonSchemas.email,
    password: Joi.string().required(),
    deviceId: Joi.string().uuid().optional(),
    rememberMe: Joi.boolean().default(false),
  }),
  
  register: Joi.object({
    email: commonSchemas.email,
    password: commonSchemas.password,
    firstName: Joi.string().min(2).max(50).required(),
    lastName: Joi.string().min(2).max(50).required(),
    phone: commonSchemas.phone.optional(),
    country: Joi.string().length(2).uppercase().required(),
    dateOfBirth: Joi.date().max('now').required(),
    acceptTerms: Joi.boolean().valid(true).required(),
  }),
  
  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: commonSchemas.password,
  }),
  
  refreshToken: Joi.object({
    refreshToken: Joi.string().required(),
  }),
};

// Transaction schemas
export const transactionSchemas = {
  create: Joi.object({
    amount: commonSchemas.amount,
    currency: commonSchemas.currency,
    toAccount: Joi.string().required(),
    description: Joi.string().max(500).optional(),
    metadata: Joi.object().optional(),
  }),
  
  search: Joi.object({
    ...commonSchemas.pagination,
    ...commonSchemas.dateRange,
    status: Joi.string().valid('pending', 'completed', 'failed', 'cancelled').optional(),
    type: Joi.string().optional(),
    minAmount: Joi.number().positive().optional(),
    maxAmount: Joi.number().positive().optional(),
  }),
};

// User schemas
export const userSchemas = {
  updateProfile: Joi.object({
    firstName: Joi.string().min(2).max(50).optional(),
    lastName: Joi.string().min(2).max(50).optional(),
    phone: commonSchemas.phone.optional(),
    country: Joi.string().length(2).uppercase().optional(),
  }),
  
  search: Joi.object({
    ...commonSchemas.pagination,
    email: Joi.string().email().optional(),
    status: Joi.string().valid('active', 'inactive', 'suspended').optional(),
    kycStatus: Joi.string().valid('pending', 'verified', 'rejected').optional(),
  }),
};

// Utility function to sanitize objects
function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitized: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const sanitizedKey = sanitizeString(key);
    sanitized[sanitizedKey] = sanitizeObject(value);
  }

  return sanitized;
}

function sanitizeString(str: any): any {
  if (typeof str !== 'string') {
    return str;
  }

  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/vbscript:/gi, '') // Remove vbscript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .trim();
}

// Request size validation
export const validateRequestSize = (maxSizeBytes: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = req.get('Content-Length');
    
    if (contentLength && parseInt(contentLength) > maxSizeBytes) {
      return res.status(413).json({
        error: 'Payload Too Large',
        message: `Request size exceeds maximum allowed size of ${maxSizeBytes} bytes`,
        requestId: (req as any).requestId,
      });
    }

    next();
  };
};

// Content type validation
export const validateContentType = (allowedTypes: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const contentType = req.get('Content-Type');
      
      if (!contentType || !allowedTypes.some(type => contentType.includes(type))) {
        return res.status(415).json({
          error: 'Unsupported Media Type',
          message: `Content-Type must be one of: ${allowedTypes.join(', ')}`,
          requestId: (req as any).requestId,
        });
      }
    }

    next();
  };
};

