import { Request, Response, NextFunction } from 'express';
import { AuthenticationService } from '../../../shared/libraries/auth';
import { Logger } from '../../../shared/libraries/logger';

export const authMiddleware = (authService: AuthenticationService, logger: Logger) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip auth for health checks
      if (req.path.startsWith('/health')) {
        return next();
      }

      const authHeader = req.get('Authorization');
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authorization header with Bearer token is required',
            timestamp: new Date().toISOString(),
          }
        });
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix
      
      try {
        const decoded = await authService.verifyToken(token);
        (req as any).user = decoded;
        
        logger.debug('User authenticated', {
          userId: decoded.userId,
          path: req.path,
          method: req.method
        });
        
        next();
      } catch (error) {
        logger.warn('Token verification failed', {
          error: (error as Error).message,
          path: req.path,
          method: req.method
        });
        
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid or expired token',
            timestamp: new Date().toISOString(),
          }
        });
      }

    } catch (error) {
      logger.error('Auth middleware error', error as Error);
      
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Authentication error',
          timestamp: new Date().toISOString(),
        }
      });
    }
  };
};

