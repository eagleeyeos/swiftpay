import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { AuthenticationService, AuthorizationService, authenticateToken } from '../../../shared/libraries/auth';
import { AuditLogger } from '../../../shared/libraries/logger';
import { CacheService } from '../services/cacheService';

interface LoginRequest {
  email: string;
  password: string;
  deviceId?: string;
  rememberMe?: boolean;
}

interface RefreshTokenRequest {
  refreshToken: string;
}

interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export const authRoutes = (
  authService: AuthenticationService,
  authzService: AuthorizationService,
  auditLogger: AuditLogger,
  cacheService: CacheService
): Router => {
  const router = Router();

  // Login endpoint
  router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('deviceId').optional().isUUID(),
    body('rememberMe').optional().isBoolean(),
  ], async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array(),
        });
      }

      const { email, password, deviceId, rememberMe }: LoginRequest = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent');

      // Check for account lockout
      const lockoutKey = `lockout:${email}`;
      const lockoutData = await cacheService.get(lockoutKey);
      
      if (lockoutData) {
        const { attempts, lockedUntil } = JSON.parse(lockoutData);
        if (lockedUntil && new Date() < new Date(lockedUntil)) {
          auditLogger.logSecurityEvent('Login attempt on locked account', undefined, {
            email,
            ipAddress,
            userAgent,
          });

          return res.status(423).json({
            error: 'Account temporarily locked due to multiple failed login attempts',
            lockedUntil,
          });
        }
      }

      // TODO: Query user from database
      // For now, using mock user data
      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'user@example.com',
        passwordHash: await authService.hashPassword('password123'),
        firstName: 'John',
        lastName: 'Doe',
        roles: ['user'],
        accountStatus: 'active',
        kycStatus: 'verified',
      };

      // Verify user exists and password is correct
      if (email !== mockUser.email || !await authService.verifyPassword(password, mockUser.passwordHash)) {
        // Track failed login attempts
        const failedKey = `failed_attempts:${email}`;
        const currentAttempts = await cacheService.get(failedKey);
        const attempts = currentAttempts ? parseInt(currentAttempts) + 1 : 1;
        
        await cacheService.set(failedKey, attempts.toString(), 900); // 15 minutes

        if (attempts >= 5) {
          const lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
          await cacheService.set(lockoutKey, JSON.stringify({
            attempts,
            lockedUntil: lockedUntil.toISOString(),
          }), 900);

          auditLogger.logSecurityEvent('Account locked due to failed login attempts', undefined, {
            email,
            attempts,
            ipAddress,
            userAgent,
          });
        }

        auditLogger.logSecurityEvent('Failed login attempt', undefined, {
          email,
          attempts,
          ipAddress,
          userAgent,
        });

        return res.status(401).json({
          error: 'Invalid email or password',
        });
      }

      // Check account status
      if (mockUser.accountStatus !== 'active') {
        auditLogger.logSecurityEvent('Login attempt on inactive account', mockUser.id, {
          email,
          accountStatus: mockUser.accountStatus,
          ipAddress,
          userAgent,
        });

        return res.status(403).json({
          error: 'Account is not active',
          accountStatus: mockUser.accountStatus,
        });
      }

      // Clear failed login attempts
      await cacheService.delete(`failed_attempts:${email}`);
      await cacheService.delete(lockoutKey);

      // Generate session
      const sessionId = authService.generateSessionId();
      const accessToken = authService.generateAccessToken({
        userId: mockUser.id,
        email: mockUser.email,
        roles: mockUser.roles,
        permissions: [], // Will be populated by authorization service
        sessionId,
        deviceId,
      });

      const refreshToken = authService.generateRefreshToken(mockUser.id, sessionId);

      // Store session in cache
      const sessionData = {
        userId: mockUser.id,
        email: mockUser.email,
        roles: mockUser.roles,
        deviceId,
        ipAddress,
        userAgent,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };

      const sessionExpiry = rememberMe ? 7 * 24 * 60 * 60 : 24 * 60 * 60; // 7 days or 24 hours
      await cacheService.set(`session:${sessionId}`, JSON.stringify(sessionData), sessionExpiry);

      // Store refresh token
      const refreshTokenExpiry = rememberMe ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60; // 30 days or 7 days
      await cacheService.set(`refresh:${sessionId}`, refreshToken, refreshTokenExpiry);

      auditLogger.logUserAction(mockUser.id, 'User login', {
        email,
        deviceId,
        ipAddress,
        userAgent,
        rememberMe,
      });

      res.json({
        accessToken,
        refreshToken,
        expiresIn: 15 * 60, // 15 minutes
        tokenType: 'Bearer',
        user: {
          id: mockUser.id,
          email: mockUser.email,
          firstName: mockUser.firstName,
          lastName: mockUser.lastName,
          roles: mockUser.roles,
          kycStatus: mockUser.kycStatus,
        },
      });

    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        error: 'Internal server error',
      });
    }
  });

  // Refresh token endpoint
  router.post('/refresh', [
    body('refreshToken').notEmpty().withMessage('Refresh token is required'),
  ], async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array(),
        });
      }

      const { refreshToken }: RefreshTokenRequest = req.body;

      // Verify refresh token
      const payload = authService.verifyRefreshToken(refreshToken);
      const { userId, sessionId } = payload;

      // Check if session exists
      const sessionData = await cacheService.get(`session:${sessionId}`);
      if (!sessionData) {
        return res.status(401).json({
          error: 'Invalid or expired session',
        });
      }

      // Check if refresh token matches
      const storedRefreshToken = await cacheService.get(`refresh:${sessionId}`);
      if (storedRefreshToken !== refreshToken) {
        auditLogger.logSecurityEvent('Invalid refresh token used', userId, {
          sessionId,
        });

        return res.status(401).json({
          error: 'Invalid refresh token',
        });
      }

      const session = JSON.parse(sessionData);

      // Generate new access token
      const newAccessToken = authService.generateAccessToken({
        userId: session.userId,
        email: session.email,
        roles: session.roles,
        permissions: [],
        sessionId,
        deviceId: session.deviceId,
      });

      // Update session activity
      session.lastActivity = new Date().toISOString();
      await cacheService.set(`session:${sessionId}`, JSON.stringify(session), 24 * 60 * 60);

      auditLogger.logUserAction(userId, 'Token refresh', {
        sessionId,
      });

      res.json({
        accessToken: newAccessToken,
        expiresIn: 15 * 60, // 15 minutes
        tokenType: 'Bearer',
      });

    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(401).json({
        error: 'Invalid or expired refresh token',
      });
    }
  });

  // Logout endpoint
  router.post('/logout', authenticateToken(authService), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { sessionId, userId } = user;

      // Remove session and refresh token from cache
      await cacheService.delete(`session:${sessionId}`);
      await cacheService.delete(`refresh:${sessionId}`);

      auditLogger.logUserAction(userId, 'User logout', {
        sessionId,
      });

      res.json({
        message: 'Logged out successfully',
      });

    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        error: 'Internal server error',
      });
    }
  });

  // Get user profile
  router.get('/profile', authenticateToken(authService), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      // TODO: Fetch full user profile from database
      // For now, returning mock data
      const userProfile = {
        id: user.userId,
        email: user.email,
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        country: 'US',
        kycStatus: 'verified',
        accountStatus: 'active',
        roles: user.roles,
        createdAt: '2023-01-01T00:00:00Z',
        lastLogin: new Date().toISOString(),
      };

      res.json(userProfile);

    } catch (error) {
      console.error('Profile error:', error);
      res.status(500).json({
        error: 'Internal server error',
      });
    }
  });

  // Change password
  router.put('/change-password', [
    authenticateToken(authService),
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  ], async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array(),
        });
      }

      const user = (req as any).user;
      const { currentPassword, newPassword }: ChangePasswordRequest = req.body;

      // TODO: Verify current password and update in database
      // For now, just logging the action

      auditLogger.logUserAction(user.userId, 'Password changed', {
        sessionId: user.sessionId,
      });

      res.json({
        message: 'Password changed successfully',
      });

    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({
        error: 'Internal server error',
      });
    }
  });

  // Logout from all devices
  router.post('/logout-all', authenticateToken(authService), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      // TODO: Invalidate all sessions for the user
      // For now, just invalidating current session
      await cacheService.delete(`session:${user.sessionId}`);
      await cacheService.delete(`refresh:${user.sessionId}`);

      auditLogger.logUserAction(user.userId, 'Logout from all devices', {
        sessionId: user.sessionId,
      });

      res.json({
        message: 'Logged out from all devices successfully',
      });

    } catch (error) {
      console.error('Logout all error:', error);
      res.status(500).json({
        error: 'Internal server error',
      });
    }
  });

  return router;
};

