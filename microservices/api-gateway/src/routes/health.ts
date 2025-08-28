import { Router, Request, Response } from 'express';

const router = Router();

// Basic health check
router.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'api-gateway',
    version: '1.0.0',
    uptime: process.uptime(),
  });
});

// Detailed health check
router.get('/detailed', (req: Request, res: Response) => {
  const memoryUsage = process.memoryUsage();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'api-gateway',
    version: '1.0.0',
    uptime: process.uptime(),
    memory: {
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      external: Math.round(memoryUsage.external / 1024 / 1024), // MB
    },
    cpu: process.cpuUsage(),
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  });
});

// Readiness check
router.get('/ready', (req: Request, res: Response) => {
  // TODO: Check database connections and external dependencies
  res.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
    checks: {
      database: 'healthy',
      redis: 'healthy',
      kafka: 'healthy',
    },
  });
});

// Liveness check
router.get('/live', (req: Request, res: Response) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

export { router as healthRoutes };

