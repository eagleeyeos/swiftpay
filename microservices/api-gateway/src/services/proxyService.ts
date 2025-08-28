import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Logger } from '../../../shared/libraries/logger';

interface ServiceConfig {
  name: string;
  baseURL: string;
  timeout: number;
  retries: number;
  healthCheckPath: string;
}

interface ProxyRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: any;
  query?: Record<string, any>;
}

interface ProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  duration: number;
}

export class ProxyService {
  private services: Map<string, AxiosInstance> = new Map();
  private serviceConfigs: Map<string, ServiceConfig> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.initializeServices();
  }

  private initializeServices(): void {
    const services: ServiceConfig[] = [
      {
        name: 'user-service',
        baseURL: `http://localhost:${process.env.USER_SERVICE_PORT || 8001}`,
        timeout: 30000,
        retries: 3,
        healthCheckPath: '/health',
      },
      {
        name: 'transaction-service',
        baseURL: `http://localhost:${process.env.TRANSACTION_SERVICE_PORT || 8002}`,
        timeout: 30000,
        retries: 3,
        healthCheckPath: '/health',
      },
      {
        name: 'billing-service',
        baseURL: `http://localhost:${process.env.BILLING_SERVICE_PORT || 8003}`,
        timeout: 30000,
        retries: 3,
        healthCheckPath: '/health',
      },
      {
        name: 'ledger-service',
        baseURL: `http://localhost:${process.env.LEDGER_SERVICE_PORT || 8004}`,
        timeout: 30000,
        retries: 3,
        healthCheckPath: '/health',
      },
      {
        name: 'tokenization-service',
        baseURL: `http://localhost:${process.env.TOKENIZATION_SERVICE_PORT || 8005}`,
        timeout: 30000,
        retries: 3,
        healthCheckPath: '/health',
      },
      {
        name: 'crypto-service',
        baseURL: `http://localhost:${process.env.CRYPTO_SERVICE_PORT || 8006}`,
        timeout: 30000,
        retries: 3,
        healthCheckPath: '/health',
      },
      {
        name: 'currency-conversion',
        baseURL: `http://localhost:${process.env.CURRENCY_CONVERSION_PORT || 8007}`,
        timeout: 30000,
        retries: 3,
        healthCheckPath: '/health',
      },
      {
        name: 'api-service',
        baseURL: `http://localhost:${process.env.API_SERVICE_PORT || 8008}`,
        timeout: 30000,
        retries: 3,
        healthCheckPath: '/health',
      },
      {
        name: 'admin-service',
        baseURL: `http://localhost:${process.env.ADMIN_SERVICE_PORT || 8009}`,
        timeout: 30000,
        retries: 3,
        healthCheckPath: '/health',
      },
    ];

    services.forEach(config => {
      this.serviceConfigs.set(config.name, config);
      
      const axiosInstance = axios.create({
        baseURL: config.baseURL,
        timeout: config.timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SwiftPayme-API-Gateway/1.0.0',
        },
      });

      // Request interceptor
      axiosInstance.interceptors.request.use(
        (config) => {
          this.logger.debug(`Proxying request to ${config.baseURL}${config.url}`, {
            method: config.method,
            url: config.url,
            headers: config.headers,
          });
          return config;
        },
        (error) => {
          this.logger.error('Proxy request error', error);
          return Promise.reject(error);
        }
      );

      // Response interceptor
      axiosInstance.interceptors.response.use(
        (response) => {
          this.logger.debug(`Received response from ${response.config.baseURL}${response.config.url}`, {
            status: response.status,
            statusText: response.statusText,
          });
          return response;
        },
        (error) => {
          this.logger.error('Proxy response error', error, {
            service: config.name,
            url: error.config?.url,
            status: error.response?.status,
            statusText: error.response?.statusText,
          });
          return Promise.reject(error);
        }
      );

      this.services.set(config.name, axiosInstance);
    });
  }

  async proxyRequest(serviceName: string, request: ProxyRequest): Promise<ProxyResponse> {
    const startTime = Date.now();
    const service = this.services.get(serviceName);
    const config = this.serviceConfigs.get(serviceName);

    if (!service || !config) {
      throw new Error(`Service ${serviceName} not found`);
    }

    try {
      const axiosConfig: AxiosRequestConfig = {
        method: request.method.toLowerCase() as any,
        url: request.path,
        headers: {
          ...request.headers,
          'X-Gateway-Service': serviceName,
          'X-Request-Timestamp': new Date().toISOString(),
        },
        params: request.query,
        data: request.body,
      };

      const response: AxiosResponse = await this.retryRequest(service, axiosConfig, config.retries);
      const duration = Date.now() - startTime;

      return {
        statusCode: response.status,
        headers: response.headers as Record<string, string>,
        body: response.data,
        duration,
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      this.logger.error(`Proxy request failed for ${serviceName}`, error, {
        service: serviceName,
        path: request.path,
        method: request.method,
        duration,
      });

      // Handle different types of errors
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error(`Service ${serviceName} is unavailable`);
      }

      if (error.response) {
        return {
          statusCode: error.response.status,
          headers: error.response.headers as Record<string, string>,
          body: error.response.data,
          duration,
        };
      }

      throw new Error(`Proxy request failed: ${error.message}`);
    }
  }

  private async retryRequest(
    service: AxiosInstance,
    config: AxiosRequestConfig,
    maxRetries: number
  ): Promise<AxiosResponse> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await service.request(config);
      } catch (error: any) {
        lastError = error;

        // Don't retry on client errors (4xx)
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
          throw error;
        }

        // Don't retry on the last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await this.sleep(delay);

        this.logger.warn(`Retrying request (attempt ${attempt + 1}/${maxRetries + 1})`, {
          url: config.url,
          method: config.method,
          delay,
        });
      }
    }

    throw lastError;
  }

  async checkServiceHealth(serviceName: string): Promise<boolean> {
    const service = this.services.get(serviceName);
    const config = this.serviceConfigs.get(serviceName);

    if (!service || !config) {
      return false;
    }

    try {
      const response = await service.get(config.healthCheckPath, { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      this.logger.warn(`Health check failed for ${serviceName}`, { error: (error as Error).message });
      return false;
    }
  }

  async checkAllServicesHealth(): Promise<Record<string, boolean>> {
    const healthChecks = Array.from(this.serviceConfigs.keys()).map(async (serviceName) => {
      const isHealthy = await this.checkServiceHealth(serviceName);
      return { serviceName, isHealthy };
    });

    const results = await Promise.all(healthChecks);
    
    return results.reduce((acc, { serviceName, isHealthy }) => {
      acc[serviceName] = isHealthy;
      return acc;
    }, {} as Record<string, boolean>);
  }

  getServiceConfig(serviceName: string): ServiceConfig | undefined {
    return this.serviceConfigs.get(serviceName);
  }

  getAllServiceConfigs(): ServiceConfig[] {
    return Array.from(this.serviceConfigs.values());
  }

  updateServiceConfig(serviceName: string, updates: Partial<ServiceConfig>): boolean {
    const currentConfig = this.serviceConfigs.get(serviceName);
    
    if (!currentConfig) {
      return false;
    }

    const newConfig = { ...currentConfig, ...updates };
    this.serviceConfigs.set(serviceName, newConfig);

    // Recreate axios instance with new config
    if (updates.baseURL || updates.timeout) {
      const axiosInstance = axios.create({
        baseURL: newConfig.baseURL,
        timeout: newConfig.timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SwiftPayme-API-Gateway/1.0.0',
        },
      });

      this.services.set(serviceName, axiosInstance);
    }

    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Circuit breaker functionality
  private circuitBreakers: Map<string, {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
  }> = new Map();

  private isCircuitOpen(serviceName: string): boolean {
    const breaker = this.circuitBreakers.get(serviceName);
    
    if (!breaker) {
      return false;
    }

    const now = Date.now();
    const threshold = 5; // failures
    const timeout = 60000; // 1 minute

    if (breaker.state === 'open') {
      if (now - breaker.lastFailure > timeout) {
        breaker.state = 'half-open';
        return false;
      }
      return true;
    }

    return false;
  }

  private recordFailure(serviceName: string): void {
    const breaker = this.circuitBreakers.get(serviceName) || {
      failures: 0,
      lastFailure: 0,
      state: 'closed' as const,
    };

    breaker.failures++;
    breaker.lastFailure = Date.now();

    if (breaker.failures >= 5) {
      breaker.state = 'open';
      this.logger.warn(`Circuit breaker opened for ${serviceName}`, {
        failures: breaker.failures,
      });
    }

    this.circuitBreakers.set(serviceName, breaker);
  }

  private recordSuccess(serviceName: string): void {
    const breaker = this.circuitBreakers.get(serviceName);
    
    if (breaker) {
      breaker.failures = 0;
      breaker.state = 'closed';
      this.circuitBreakers.set(serviceName, breaker);
    }
  }
}

