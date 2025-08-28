import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const securityMiddleware = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Add request ID if not present
    if (!(req as any).requestId) {
      (req as any).requestId = uuidv4();
    }

    // Add security headers
    res.setHeader('X-Request-ID', (req as any).requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // Remove server information
    res.removeHeader('X-Powered-By');

    // Validate Content-Type for POST/PUT requests
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const contentType = req.get('Content-Type');
      if (contentType && !contentType.includes('application/json') && !contentType.includes('application/x-www-form-urlencoded')) {
        return res.status(415).json({
          error: 'Unsupported Media Type',
          message: 'Content-Type must be application/json or application/x-www-form-urlencoded',
        });
      }
    }

    // Check for suspicious patterns in URL
    const suspiciousPatterns = [
      /\.\./,  // Directory traversal
      /<script/i,  // XSS attempts
      /javascript:/i,  // JavaScript injection
      /vbscript:/i,  // VBScript injection
      /onload=/i,  // Event handler injection
      /onerror=/i,  // Event handler injection
    ];

    const url = req.url.toLowerCase();
    if (suspiciousPatterns.some(pattern => pattern.test(url))) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Suspicious request pattern detected',
        requestId: (req as any).requestId,
      });
    }

    // Check for SQL injection patterns in query parameters
    const queryString = JSON.stringify(req.query).toLowerCase();
    const sqlPatterns = [
      /union\s+select/,
      /drop\s+table/,
      /delete\s+from/,
      /insert\s+into/,
      /update\s+set/,
      /exec\s*\(/,
      /script\s*>/,
    ];

    if (sqlPatterns.some(pattern => pattern.test(queryString))) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Suspicious query parameters detected',
        requestId: (req as any).requestId,
      });
    }

    // Rate limiting based on IP
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    
    // Add client IP to request for logging
    (req as any).clientIP = clientIP;

    next();
  };
};

export const apiKeyMiddleware = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.get('X-API-Key');
    
    if (!apiKey) {
      return res.status(401).json({
        error: 'API Key Required',
        message: 'X-API-Key header is required for API access',
      });
    }

    // TODO: Validate API key against database
    // For now, just checking if it's present
    (req as any).apiKey = apiKey;
    
    next();
  };
};

export const corsMiddleware = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('Origin');
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];

    if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-API-Key');
      res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    }

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    next();
  };
};

export const ipWhitelistMiddleware = (whitelist: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (!clientIP || !whitelist.includes(clientIP)) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'Your IP address is not authorized to access this resource',
        requestId: (req as any).requestId,
      });
    }

    next();
  };
};

export const userAgentValidationMiddleware = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userAgent = req.get('User-Agent');
    
    if (!userAgent) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'User-Agent header is required',
      });
    }

    // Block known bad user agents
    const blockedUserAgents = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /scraper/i,
    ];

    if (process.env.BLOCK_BOTS === 'true' && blockedUserAgents.some(pattern => pattern.test(userAgent))) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'Automated requests are not allowed',
      });
    }

    next();
  };
};

export const requestSizeMiddleware = (maxSize: number = 10 * 1024 * 1024) => { // 10MB default
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = req.get('Content-Length');
    
    if (contentLength && parseInt(contentLength) > maxSize) {
      return res.status(413).json({
        error: 'Payload Too Large',
        message: `Request body size exceeds maximum allowed size of ${maxSize} bytes`,
        maxSize,
      });
    }

    next();
  };
};

