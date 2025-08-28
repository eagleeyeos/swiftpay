interface RequestMetric {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  timestamp: number;
}

interface ProxyMetric {
  service: string;
  statusCode: number;
  timestamp: number;
}

interface ServiceHealth {
  service: string;
  healthy: boolean;
  lastCheck: number;
  responseTime: number;
}

export class MetricsService {
  private requestMetrics: RequestMetric[] = [];
  private proxyMetrics: ProxyMetric[] = [];
  private errorCounts: Map<string, number> = new Map();
  private serviceHealth: Map<string, ServiceHealth> = new Map();
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
    this.initializeCleanup();
  }

  private initializeCleanup(): void {
    // Clean up old metrics every 5 minutes
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 5 * 60 * 1000);
  }

  private cleanupOldMetrics(): void {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    this.requestMetrics = this.requestMetrics.filter(
      metric => metric.timestamp > oneHourAgo
    );
    
    this.proxyMetrics = this.proxyMetrics.filter(
      metric => metric.timestamp > oneHourAgo
    );
  }

  recordRequest(method: string, path: string, statusCode: number, duration: number): void {
    this.requestMetrics.push({
      method,
      path: this.normalizePath(path),
      statusCode,
      duration,
      timestamp: Date.now(),
    });

    // Track error counts
    if (statusCode >= 400) {
      const errorKey = `${method}:${this.normalizePath(path)}:${statusCode}`;
      this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
    }
  }

  recordProxyRequest(service: string, statusCode: number): void {
    this.proxyMetrics.push({
      service,
      statusCode,
      timestamp: Date.now(),
    });

    // Update service health
    const isHealthy = statusCode < 500;
    this.serviceHealth.set(service, {
      service,
      healthy: isHealthy,
      lastCheck: Date.now(),
      responseTime: 0, // Would be calculated from actual response time
    });
  }

  recordProxyError(service: string): void {
    this.proxyMetrics.push({
      service,
      statusCode: 503,
      timestamp: Date.now(),
    });

    this.serviceHealth.set(service, {
      service,
      healthy: false,
      lastCheck: Date.now(),
      responseTime: -1,
    });
  }

  private normalizePath(path: string): string {
    // Replace UUIDs and IDs with placeholders for better grouping
    return path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
      .replace(/\/\d+/g, '/:id');
  }

  getRequestStats(timeWindow: number = 3600000): any { // Default 1 hour
    const cutoff = Date.now() - timeWindow;
    const recentMetrics = this.requestMetrics.filter(m => m.timestamp > cutoff);

    const totalRequests = recentMetrics.length;
    const successfulRequests = recentMetrics.filter(m => m.statusCode < 400).length;
    const errorRequests = recentMetrics.filter(m => m.statusCode >= 400).length;

    const durations = recentMetrics.map(m => m.duration);
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;

    // Calculate percentiles
    const sortedDurations = durations.sort((a, b) => a - b);
    const p50 = this.getPercentile(sortedDurations, 50);
    const p95 = this.getPercentile(sortedDurations, 95);
    const p99 = this.getPercentile(sortedDurations, 99);

    // Group by status code
    const statusCodes = recentMetrics.reduce((acc, metric) => {
      acc[metric.statusCode] = (acc[metric.statusCode] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    // Group by endpoint
    const endpoints = recentMetrics.reduce((acc, metric) => {
      const key = `${metric.method} ${metric.path}`;
      if (!acc[key]) {
        acc[key] = { count: 0, avgDuration: 0, errors: 0 };
      }
      acc[key].count++;
      acc[key].avgDuration = (acc[key].avgDuration * (acc[key].count - 1) + metric.duration) / acc[key].count;
      if (metric.statusCode >= 400) {
        acc[key].errors++;
      }
      return acc;
    }, {} as Record<string, any>);

    return {
      totalRequests,
      successfulRequests,
      errorRequests,
      successRate: totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100,
      avgDuration: Math.round(avgDuration),
      maxDuration,
      minDuration,
      percentiles: {
        p50: Math.round(p50),
        p95: Math.round(p95),
        p99: Math.round(p99),
      },
      statusCodes,
      endpoints,
      requestsPerMinute: Math.round((totalRequests / (timeWindow / 60000))),
    };
  }

  getProxyStats(timeWindow: number = 3600000): any {
    const cutoff = Date.now() - timeWindow;
    const recentMetrics = this.proxyMetrics.filter(m => m.timestamp > cutoff);

    const serviceStats = recentMetrics.reduce((acc, metric) => {
      if (!acc[metric.service]) {
        acc[metric.service] = {
          totalRequests: 0,
          successfulRequests: 0,
          errorRequests: 0,
          serverErrors: 0,
        };
      }

      acc[metric.service].totalRequests++;
      
      if (metric.statusCode < 400) {
        acc[metric.service].successfulRequests++;
      } else if (metric.statusCode >= 500) {
        acc[metric.service].serverErrors++;
        acc[metric.service].errorRequests++;
      } else {
        acc[metric.service].errorRequests++;
      }

      return acc;
    }, {} as Record<string, any>);

    // Calculate success rates
    Object.keys(serviceStats).forEach(service => {
      const stats = serviceStats[service];
      stats.successRate = stats.totalRequests > 0 
        ? (stats.successfulRequests / stats.totalRequests) * 100 
        : 100;
    });

    return {
      services: serviceStats,
      totalProxyRequests: recentMetrics.length,
    };
  }

  getServiceHealth(): Record<string, ServiceHealth> {
    const health: Record<string, ServiceHealth> = {};
    
    this.serviceHealth.forEach((value, key) => {
      health[key] = { ...value };
    });

    return health;
  }

  getSystemStats(): any {
    const uptime = Date.now() - this.startTime;
    const memoryUsage = process.memoryUsage();

    return {
      uptime: Math.floor(uptime / 1000), // seconds
      uptimeFormatted: this.formatUptime(uptime),
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
        external: Math.round(memoryUsage.external / 1024 / 1024), // MB
      },
      cpu: process.cpuUsage(),
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    };
  }

  getErrorStats(timeWindow: number = 3600000): any {
    const cutoff = Date.now() - timeWindow;
    const recentErrors = Array.from(this.errorCounts.entries())
      .map(([key, count]) => ({ error: key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 errors

    return {
      topErrors: recentErrors,
      totalErrorTypes: this.errorCounts.size,
    };
  }

  private getPercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)] || 0;
  }

  private formatUptime(uptime: number): string {
    const seconds = Math.floor(uptime / 1000) % 60;
    const minutes = Math.floor(uptime / (1000 * 60)) % 60;
    const hours = Math.floor(uptime / (1000 * 60 * 60)) % 24;
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24));

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // Prometheus-style metrics export
  getPrometheusMetrics(): string {
    const requestStats = this.getRequestStats();
    const proxyStats = this.getProxyStats();
    const systemStats = this.getSystemStats();

    let metrics = '';

    // Request metrics
    metrics += `# HELP http_requests_total Total number of HTTP requests\n`;
    metrics += `# TYPE http_requests_total counter\n`;
    metrics += `http_requests_total ${requestStats.totalRequests}\n\n`;

    metrics += `# HELP http_request_duration_seconds HTTP request duration in seconds\n`;
    metrics += `# TYPE http_request_duration_seconds histogram\n`;
    metrics += `http_request_duration_seconds_sum ${requestStats.avgDuration * requestStats.totalRequests / 1000}\n`;
    metrics += `http_request_duration_seconds_count ${requestStats.totalRequests}\n\n`;

    // System metrics
    metrics += `# HELP process_uptime_seconds Process uptime in seconds\n`;
    metrics += `# TYPE process_uptime_seconds counter\n`;
    metrics += `process_uptime_seconds ${systemStats.uptime}\n\n`;

    metrics += `# HELP process_memory_rss_bytes Process memory RSS in bytes\n`;
    metrics += `# TYPE process_memory_rss_bytes gauge\n`;
    metrics += `process_memory_rss_bytes ${systemStats.memory.rss * 1024 * 1024}\n\n`;

    return metrics;
  }

  reset(): void {
    this.requestMetrics = [];
    this.proxyMetrics = [];
    this.errorCounts.clear();
    this.serviceHealth.clear();
  }
}

