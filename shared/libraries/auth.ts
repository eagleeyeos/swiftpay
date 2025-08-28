import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export interface JWTPayload {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  sessionId: string;
  deviceId?: string;
  iat?: number;
  exp?: number;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenSecret: string;
  refreshTokenExpiresIn: string;
  bcryptRounds: number;
  sessionTimeout: number;
  maxFailedAttempts: number;
  lockoutDuration: number;
}

export class AuthenticationService {
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.config.bcryptRounds);
  }

  async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: this.config.jwtExpiresIn,
      issuer: 'swiftpayme',
      audience: 'swiftpayme-api',
    });
  }

  generateRefreshToken(userId: string, sessionId: string): string {
    const payload = {
      userId,
      sessionId,
      type: 'refresh',
    };

    return jwt.sign(payload, this.config.refreshTokenSecret, {
      expiresIn: this.config.refreshTokenExpiresIn,
      issuer: 'swiftpayme',
      audience: 'swiftpayme-api',
    });
  }

  verifyAccessToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, this.config.jwtSecret, {
        issuer: 'swiftpayme',
        audience: 'swiftpayme-api',
      }) as JWTPayload;
    } catch (error) {
      throw new Error('Invalid or expired access token');
    }
  }

  verifyRefreshToken(token: string): any {
    try {
      return jwt.verify(token, this.config.refreshTokenSecret, {
        issuer: 'swiftpayme',
        audience: 'swiftpayme-api',
      });
    } catch (error) {
      throw new Error('Invalid or expired refresh token');
    }
  }

  generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  generateApiKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  verifyApiKey(apiKey: string, hashedApiKey: string): boolean {
    const hashedInput = this.hashApiKey(apiKey);
    return crypto.timingSafeEqual(Buffer.from(hashedInput), Buffer.from(hashedApiKey));
  }
}

export class AuthorizationService {
  private permissions: Map<string, string[]> = new Map();
  private roleHierarchy: Map<string, string[]> = new Map();

  constructor() {
    this.initializeDefaultRoles();
  }

  private initializeDefaultRoles(): void {
    // Define role hierarchy
    this.roleHierarchy.set('super_admin', ['admin', 'user']);
    this.roleHierarchy.set('admin', ['user']);
    this.roleHierarchy.set('user', []);

    // Define permissions for each role
    this.permissions.set('super_admin', [
      'system:*',
      'users:*',
      'transactions:*',
      'admin:*',
      'settings:*',
    ]);

    this.permissions.set('admin', [
      'users:read',
      'users:update',
      'users:freeze',
      'transactions:read',
      'transactions:search',
      'balances:read',
      'balances:adjust',
      'support:*',
      'reports:read',
    ]);

    this.permissions.set('user', [
      'profile:read',
      'profile:update',
      'transactions:create',
      'transactions:read:own',
      'balances:read:own',
      'tokens:transfer',
      'tokens:read:own',
    ]);
  }

  hasPermission(userRoles: string[], requiredPermission: string): boolean {
    const userPermissions = this.getUserPermissions(userRoles);
    
    // Check for exact permission match
    if (userPermissions.includes(requiredPermission)) {
      return true;
    }

    // Check for wildcard permissions
    const permissionParts = requiredPermission.split(':');
    for (let i = permissionParts.length - 1; i >= 0; i--) {
      const wildcardPermission = permissionParts.slice(0, i).join(':') + ':*';
      if (userPermissions.includes(wildcardPermission)) {
        return true;
      }
    }

    return false;
  }

  private getUserPermissions(userRoles: string[]): string[] {
    const allPermissions = new Set<string>();

    for (const role of userRoles) {
      // Add direct permissions
      const rolePermissions = this.permissions.get(role) || [];
      rolePermissions.forEach(permission => allPermissions.add(permission));

      // Add inherited permissions from role hierarchy
      const inheritedRoles = this.getInheritedRoles(role);
      for (const inheritedRole of inheritedRoles) {
        const inheritedPermissions = this.permissions.get(inheritedRole) || [];
        inheritedPermissions.forEach(permission => allPermissions.add(permission));
      }
    }

    return Array.from(allPermissions);
  }

  private getInheritedRoles(role: string): string[] {
    const inherited: string[] = [];
    const toProcess = [role];
    const processed = new Set<string>();

    while (toProcess.length > 0) {
      const currentRole = toProcess.pop()!;
      if (processed.has(currentRole)) continue;
      
      processed.add(currentRole);
      const childRoles = this.roleHierarchy.get(currentRole) || [];
      
      for (const childRole of childRoles) {
        if (!inherited.includes(childRole)) {
          inherited.push(childRole);
          toProcess.push(childRole);
        }
      }
    }

    return inherited;
  }

  addRole(role: string, permissions: string[], parentRoles: string[] = []): void {
    this.permissions.set(role, permissions);
    this.roleHierarchy.set(role, parentRoles);
  }

  removeRole(role: string): void {
    this.permissions.delete(role);
    this.roleHierarchy.delete(role);
  }
}

export const authenticateToken = (authService: AuthenticationService) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    try {
      const payload = authService.verifyAccessToken(token);
      (req as any).user = payload;
      next();
    } catch (error) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
  };
};

export const requirePermission = (authzService: AuthorizationService, permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as JWTPayload;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!authzService.hasPermission(user.roles, permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

export const requireRole = (requiredRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as JWTPayload;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const hasRequiredRole = requiredRoles.some(role => user.roles.includes(role));
    if (!hasRequiredRole) {
      return res.status(403).json({ error: 'Insufficient role privileges' });
    }

    next();
  };
};

export const getDefaultAuthConfig = (): AuthConfig => {
  return {
    jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || 'your-super-secret-refresh-key-change-in-production',
    refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
    sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || '900000'), // 15 minutes
    maxFailedAttempts: parseInt(process.env.MAX_FAILED_ATTEMPTS || '5'),
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION || '900000'), // 15 minutes
  };
};

