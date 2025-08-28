import { Router, Request, Response } from 'express';
import { MetricsService } from '../services/metricsService';

export const metricsRoutes = (metricsService: MetricsService): Router => {
  const router = Router();

  // Prometheus metrics endpoint
  router.get('/', (req: Request, res: Response) => {
    res.set('Content-Type', 'text/plain');
    res.send(metricsService.getPrometheusMetrics());
  });

  // JSON metrics endpoint
  router.get('/json', (req: Request, res: Response) => {
    const timeWindow = parseInt(req.query.window as string) || 3600000; // Default 1 hour

    const metrics = {
      timestamp: new Date().toISOString(),
      timeWindow: timeWindow,
      requests: metricsService.getRequestStats(timeWindow),
      proxy: metricsService.getProxyStats(timeWindow),
      system: metricsService.getSystemStats(),
      serviceHealth: metricsService.getServiceHealth(),
      errors: metricsService.getErrorStats(timeWindow),
    };

    res.json(metrics);
  });

  // Request statistics
  router.get('/requests', (req: Request, res: Response) => {
    const timeWindow = parseInt(req.query.window as string) || 3600000; // Default 1 hour
    const stats = metricsService.getRequestStats(timeWindow);
    
    res.json({
      timestamp: new Date().toISOString(),
      timeWindow,
      ...stats,
    });
  });

  // Proxy statistics
  router.get('/proxy', (req: Request, res: Response) => {
    const timeWindow = parseInt(req.query.window as string) || 3600000; // Default 1 hour
    const stats = metricsService.getProxyStats(timeWindow);
    
    res.json({
      timestamp: new Date().toISOString(),
      timeWindow,
      ...stats,
    });
  });

  // Service health
  router.get('/health', (req: Request, res: Response) => {
    const health = metricsService.getServiceHealth();
    
    res.json({
      timestamp: new Date().toISOString(),
      services: health,
    });
  });

  // System statistics
  router.get('/system', (req: Request, res: Response) => {
    const stats = metricsService.getSystemStats();
    
    res.json({
      timestamp: new Date().toISOString(),
      ...stats,
    });
  });

  // Error statistics
  router.get('/errors', (req: Request, res: Response) => {
    const timeWindow = parseInt(req.query.window as string) || 3600000; // Default 1 hour
    const stats = metricsService.getErrorStats(timeWindow);
    
    res.json({
      timestamp: new Date().toISOString(),
      timeWindow,
      ...stats,
    });
  });

  return router;
};

