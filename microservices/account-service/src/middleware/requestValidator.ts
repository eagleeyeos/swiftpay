import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

export const validateSchema = (schema: Joi.ObjectSchema, target: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = req[target];
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value,
          })),
          timestamp: new Date().toISOString(),
        }
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
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  amount: Joi.string().pattern(/^\d+(\.\d{1,8})?$/).required(),
  currency: Joi.string().length(3).uppercase().required(),
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().valid('asc', 'desc').default('desc'),
    sortBy: Joi.string().default('createdAt'),
  },
};

// Account schemas
export const accountSchemas = {
  create: Joi.object({
    userId: commonSchemas.uuid,
    accountType: Joi.string().valid('personal', 'business', 'system', 'reserve').required(),
    currency: commonSchemas.currency,
    metadata: Joi.object().optional(),
  }),
  
  update: Joi.object({
    status: Joi.string().valid('active', 'inactive', 'suspended', 'closed').optional(),
    metadata: Joi.object().optional(),
  }),
  
  search: Joi.object({
    userId: commonSchemas.uuid.optional(),
    accountType: Joi.string().optional(),
    status: Joi.string().optional(),
    currency: Joi.string().length(3).uppercase().optional(),
    ...commonSchemas.pagination,
  }),
};

// Balance schemas
export const balanceSchemas = {
  update: Joi.object({
    accountId: commonSchemas.uuid,
    amount: commonSchemas.amount,
    currency: commonSchemas.currency,
    operationType: Joi.string().valid('credit', 'debit', 'reserve', 'release').required(),
    reference: Joi.string().max(100).required(),
    description: Joi.string().max(500).optional(),
    metadata: Joi.object().optional(),
  }),
  
  transfer: Joi.object({
    fromAccountId: commonSchemas.uuid,
    toAccountId: commonSchemas.uuid,
    amount: commonSchemas.amount,
    currency: commonSchemas.currency,
    reference: Joi.string().max(100).required(),
    description: Joi.string().max(500).optional(),
    metadata: Joi.object().optional(),
  }),
};

// Profile schemas
export const profileSchemas = {
  create: Joi.object({
    userId: commonSchemas.uuid,
    personalInfo: Joi.object({
      firstName: Joi.string().min(2).max(50).required(),
      lastName: Joi.string().min(2).max(50).required(),
      middleName: Joi.string().min(2).max(50).optional(),
      dateOfBirth: Joi.date().max('now').required(),
      nationality: Joi.string().length(2).uppercase().required(),
      gender: Joi.string().valid('male', 'female', 'other').optional(),
    }).required(),
    contactInfo: Joi.object({
      email: commonSchemas.email,
      phone: commonSchemas.phone,
      alternatePhone: commonSchemas.phone.optional(),
      preferredLanguage: Joi.string().length(2).default('en'),
      timezone: Joi.string().default('UTC'),
    }).required(),
    address: Joi.object({
      street: Joi.string().min(5).max(200).required(),
      city: Joi.string().min(2).max(100).required(),
      state: Joi.string().min(2).max(100).required(),
      postalCode: Joi.string().min(3).max(20).required(),
      country: Joi.string().length(2).uppercase().required(),
    }).required(),
  }),
  
  update: Joi.object({
    personalInfo: Joi.object({
      firstName: Joi.string().min(2).max(50).optional(),
      lastName: Joi.string().min(2).max(50).optional(),
      middleName: Joi.string().min(2).max(50).optional(),
      dateOfBirth: Joi.date().max('now').optional(),
      nationality: Joi.string().length(2).uppercase().optional(),
      gender: Joi.string().valid('male', 'female', 'other').optional(),
    }).optional(),
    contactInfo: Joi.object({
      email: commonSchemas.email.optional(),
      phone: commonSchemas.phone.optional(),
      alternatePhone: commonSchemas.phone.optional(),
      preferredLanguage: Joi.string().length(2).optional(),
      timezone: Joi.string().optional(),
    }).optional(),
    address: Joi.object({
      street: Joi.string().min(5).max(200).optional(),
      city: Joi.string().min(2).max(100).optional(),
      state: Joi.string().min(2).max(100).optional(),
      postalCode: Joi.string().min(3).max(20).optional(),
      country: Joi.string().length(2).uppercase().optional(),
    }).optional(),
    preferences: Joi.object({
      notifications: Joi.object({
        email: Joi.boolean().optional(),
        sms: Joi.boolean().optional(),
        push: Joi.boolean().optional(),
      }).optional(),
      security: Joi.object({
        twoFactorEnabled: Joi.boolean().optional(),
        biometricEnabled: Joi.boolean().optional(),
        sessionTimeout: Joi.number().min(300000).max(86400000).optional(), // 5 min to 24 hours
      }).optional(),
      trading: Joi.object({
        riskTolerance: Joi.string().valid('low', 'medium', 'high').optional(),
        autoInvest: Joi.boolean().optional(),
      }).optional(),
    }).optional(),
    metadata: Joi.object().optional(),
  }),
};

