import { Pool } from 'pg';
import { createClient } from 'redis';
import { MongoClient } from 'mongodb';

export interface DatabaseConfig {
  postgres: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: boolean;
    maxConnections?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    maxRetriesPerRequest?: number;
    retryDelayOnFailover?: number;
  };
  mongodb: {
    uri: string;
    database: string;
    options?: {
      maxPoolSize?: number;
      serverSelectionTimeoutMS?: number;
      socketTimeoutMS?: number;
    };
  };
}

export class DatabaseManager {
  private postgresPool: Pool | null = null;
  private redisClient: any = null;
  private mongoClient: MongoClient | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async initializePostgres(): Promise<Pool> {
    if (this.postgresPool) {
      return this.postgresPool;
    }

    this.postgresPool = new Pool({
      host: this.config.postgres.host,
      port: this.config.postgres.port,
      database: this.config.postgres.database,
      user: this.config.postgres.username,
      password: this.config.postgres.password,
      ssl: this.config.postgres.ssl,
      max: this.config.postgres.maxConnections || 20,
      idleTimeoutMillis: this.config.postgres.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: this.config.postgres.connectionTimeoutMillis || 2000,
    });

    // Test connection
    try {
      const client = await this.postgresPool.connect();
      await client.query('SELECT NOW()');
      client.release();
      console.log('PostgreSQL connection established successfully');
    } catch (error) {
      console.error('Failed to connect to PostgreSQL:', error);
      throw error;
    }

    return this.postgresPool;
  }

  async initializeRedis(): Promise<any> {
    if (this.redisClient) {
      return this.redisClient;
    }

    this.redisClient = createClient({
      socket: {
        host: this.config.redis.host,
        port: this.config.redis.port,
      },
      password: this.config.redis.password,
      database: this.config.redis.db || 0,
    });

    this.redisClient.on('error', (err: Error) => {
      console.error('Redis Client Error:', err);
    });

    this.redisClient.on('connect', () => {
      console.log('Redis connection established successfully');
    });

    await this.redisClient.connect();
    return this.redisClient;
  }

  async initializeMongoDB(): Promise<MongoClient> {
    if (this.mongoClient) {
      return this.mongoClient;
    }

    this.mongoClient = new MongoClient(this.config.mongodb.uri, {
      maxPoolSize: this.config.mongodb.options?.maxPoolSize || 10,
      serverSelectionTimeoutMS: this.config.mongodb.options?.serverSelectionTimeoutMS || 5000,
      socketTimeoutMS: this.config.mongodb.options?.socketTimeoutMS || 45000,
    });

    try {
      await this.mongoClient.connect();
      await this.mongoClient.db(this.config.mongodb.database).admin().ping();
      console.log('MongoDB connection established successfully');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      throw error;
    }

    return this.mongoClient;
  }

  async closeConnections(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.postgresPool) {
      promises.push(this.postgresPool.end());
      this.postgresPool = null;
    }

    if (this.redisClient) {
      promises.push(this.redisClient.quit());
      this.redisClient = null;
    }

    if (this.mongoClient) {
      promises.push(this.mongoClient.close());
      this.mongoClient = null;
    }

    await Promise.all(promises);
    console.log('All database connections closed');
  }

  getPostgresPool(): Pool {
    if (!this.postgresPool) {
      throw new Error('PostgreSQL pool not initialized. Call initializePostgres() first.');
    }
    return this.postgresPool;
  }

  getRedisClient(): any {
    if (!this.redisClient) {
      throw new Error('Redis client not initialized. Call initializeRedis() first.');
    }
    return this.redisClient;
  }

  getMongoClient(): MongoClient {
    if (!this.mongoClient) {
      throw new Error('MongoDB client not initialized. Call initializeMongoDB() first.');
    }
    return this.mongoClient;
  }
}

export const createDatabaseManager = (config: DatabaseConfig): DatabaseManager => {
  return new DatabaseManager(config);
};

export const getDefaultDatabaseConfig = (): DatabaseConfig => {
  return {
    postgres: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'swiftpayme',
      username: process.env.POSTGRES_USER || 'swiftpayme',
      password: process.env.POSTGRES_PASSWORD || 'swiftpayme123',
      ssl: process.env.POSTGRES_SSL === 'true',
      maxConnections: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '20'),
      idleTimeoutMillis: parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT || '2000'),
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3'),
      retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY || '100'),
    },
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
      database: process.env.MONGODB_DATABASE || 'swiftpayme',
      options: {
        maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10'),
        serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT || '5000'),
        socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT || '45000'),
      },
    },
  };
};

