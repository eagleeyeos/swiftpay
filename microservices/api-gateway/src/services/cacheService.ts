import { RedisClientType } from 'redis';

export class CacheService {
  private client: RedisClientType | null = null;

  async initialize(redisClient: RedisClientType): Promise<void> {
    this.client = redisClient;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      const result = await this.client.exists(key);
      return result > 0;
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  }

  async increment(key: string, ttlSeconds?: number): Promise<number> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      const result = await this.client.incr(key);
      if (ttlSeconds && result === 1) {
        await this.client.expire(key, ttlSeconds);
      }
      return result;
    } catch (error) {
      console.error('Cache increment error:', error);
      throw error;
    }
  }

  async setHash(key: string, field: string, value: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      await this.client.hSet(key, field, value);
      return true;
    } catch (error) {
      console.error('Cache setHash error:', error);
      return false;
    }
  }

  async getHash(key: string, field: string): Promise<string | undefined> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      return await this.client.hGet(key, field);
    } catch (error) {
      console.error('Cache getHash error:', error);
      return undefined;
    }
  }

  async getAllHash(key: string): Promise<Record<string, string>> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      return await this.client.hGetAll(key);
    } catch (error) {
      console.error('Cache getAllHash error:', error);
      return {};
    }
  }

  async addToSet(key: string, value: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      const result = await this.client.sAdd(key, value);
      return result > 0;
    } catch (error) {
      console.error('Cache addToSet error:', error);
      return false;
    }
  }

  async isInSet(key: string, value: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      return await this.client.sIsMember(key, value);
    } catch (error) {
      console.error('Cache isInSet error:', error);
      return false;
    }
  }

  async removeFromSet(key: string, value: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      const result = await this.client.sRem(key, value);
      return result > 0;
    } catch (error) {
      console.error('Cache removeFromSet error:', error);
      return false;
    }
  }

  async getSetMembers(key: string): Promise<string[]> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      return await this.client.sMembers(key);
    } catch (error) {
      console.error('Cache getSetMembers error:', error);
      return [];
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      return await this.client.expire(key, ttlSeconds);
    } catch (error) {
      console.error('Cache expire error:', error);
      return false;
    }
  }

  async getTTL(key: string): Promise<number> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      return await this.client.ttl(key);
    } catch (error) {
      console.error('Cache getTTL error:', error);
      return -1;
    }
  }

  async flushAll(): Promise<boolean> {
    if (!this.client) {
      throw new Error('Cache service not initialized');
    }

    try {
      await this.client.flushAll();
      return true;
    } catch (error) {
      console.error('Cache flushAll error:', error);
      return false;
    }
  }
}

