import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';

import { DatabaseManager } from '../../../shared/config/database';
import { Logger, AuditLogger } from '../../../shared/libraries/logger';

export interface Account {
  id: string;
  userId: string;
  accountNumber: string;
  accountType: 'personal' | 'business' | 'system' | 'reserve';
  status: 'active' | 'inactive' | 'suspended' | 'closed';
  currency: string;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt?: Date;
}

export interface CreateAccountRequest {
  userId: string;
  accountType: 'personal' | 'business' | 'system' | 'reserve';
  currency: string;
  metadata?: any;
}

export interface UpdateAccountRequest {
  status?: 'active' | 'inactive' | 'suspended' | 'closed';
  metadata?: any;
}

export interface AccountSearchFilters {
  userId?: string;
  accountType?: string;
  status?: string;
  currency?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export class AccountService {
  private db: Pool;
  private logger: Logger;
  private auditLogger: AuditLogger;

  constructor(
    private dbManager: DatabaseManager,
    logger: Logger,
    auditLogger: AuditLogger
  ) {
    this.logger = logger;
    this.auditLogger = auditLogger;
  }

  async initialize(): Promise<void> {
    this.db = this.dbManager.getPostgresPool();
    await this.createTables();
    this.logger.info('AccountService initialized');
  }

  private async createTables(): Promise<void> {
    const createAccountsTable = `
      CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        account_number VARCHAR(20) UNIQUE NOT NULL,
        account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('personal', 'business', 'system', 'reserve')),
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'closed')),
        currency VARCHAR(10) NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
      CREATE INDEX IF NOT EXISTS idx_accounts_account_number ON accounts(account_number);
      CREATE INDEX IF NOT EXISTS idx_accounts_type_status ON accounts(account_type, status);
      CREATE INDEX IF NOT EXISTS idx_accounts_currency ON accounts(currency);

      CREATE TABLE IF NOT EXISTS account_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES accounts(id),
        action VARCHAR(50) NOT NULL,
        previous_status VARCHAR(20),
        new_status VARCHAR(20),
        changed_by UUID,
        reason TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_account_history_account_id ON account_history(account_id);
      CREATE INDEX IF NOT EXISTS idx_account_history_created_at ON account_history(created_at);
    `;

    await this.db.query(createAccountsTable);
  }

  async createAccount(request: CreateAccountRequest, createdBy?: string): Promise<Account> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // Generate unique account number
      const accountNumber = await this.generateAccountNumber(request.accountType);

      const insertQuery = `
        INSERT INTO accounts (user_id, account_number, account_type, currency, metadata)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;

      const result = await client.query(insertQuery, [
        request.userId,
        accountNumber,
        request.accountType,
        request.currency,
        JSON.stringify(request.metadata || {})
      ]);

      const account = this.mapRowToAccount(result.rows[0]);

      // Log account creation in history
      await this.logAccountHistory(
        client,
        account.id,
        'account_created',
        null,
        'active',
        createdBy,
        'Account created',
        { accountType: request.accountType, currency: request.currency }
      );

      await client.query('COMMIT');

      this.auditLogger.logUserAction(
        request.userId,
        'Account created',
        {
          accountId: account.id,
          accountNumber: account.accountNumber,
          accountType: request.accountType,
          currency: request.currency,
          createdBy
        }
      );

      this.logger.info('Account created successfully', {
        accountId: account.id,
        userId: request.userId,
        accountType: request.accountType,
        currency: request.currency
      });

      return account;

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to create account', error as Error, {
        userId: request.userId,
        accountType: request.accountType,
        currency: request.currency
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async getAccount(accountId: string): Promise<Account | null> {
    try {
      const query = 'SELECT * FROM accounts WHERE id = $1';
      const result = await this.db.query(query, [accountId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToAccount(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to get account', error as Error, { accountId });
      throw error;
    }
  }

  async getAccountByNumber(accountNumber: string): Promise<Account | null> {
    try {
      const query = 'SELECT * FROM accounts WHERE account_number = $1';
      const result = await this.db.query(query, [accountNumber]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToAccount(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to get account by number', error as Error, { accountNumber });
      throw error;
    }
  }

  async getUserAccounts(userId: string): Promise<Account[]> {
    try {
      const query = `
        SELECT * FROM accounts 
        WHERE user_id = $1 
        ORDER BY created_at DESC
      `;
      const result = await this.db.query(query, [userId]);

      return result.rows.map(row => this.mapRowToAccount(row));

    } catch (error) {
      this.logger.error('Failed to get user accounts', error as Error, { userId });
      throw error;
    }
  }

  async updateAccount(
    accountId: string, 
    updates: UpdateAccountRequest, 
    updatedBy?: string
  ): Promise<Account> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Get current account
      const currentResult = await client.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
      if (currentResult.rows.length === 0) {
        throw new Error('Account not found');
      }

      const currentAccount = this.mapRowToAccount(currentResult.rows[0]);

      // Build update query
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (updates.status !== undefined) {
        updateFields.push(`status = $${paramIndex++}`);
        updateValues.push(updates.status);
      }

      if (updates.metadata !== undefined) {
        updateFields.push(`metadata = $${paramIndex++}`);
        updateValues.push(JSON.stringify(updates.metadata));
      }

      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      updateValues.push(accountId);

      const updateQuery = `
        UPDATE accounts 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await client.query(updateQuery, updateValues);
      const updatedAccount = this.mapRowToAccount(result.rows[0]);

      // Log status change if applicable
      if (updates.status && updates.status !== currentAccount.status) {
        await this.logAccountHistory(
          client,
          accountId,
          'status_changed',
          currentAccount.status,
          updates.status,
          updatedBy,
          'Account status updated'
        );
      }

      await client.query('COMMIT');

      this.auditLogger.logUserAction(
        updatedAccount.userId,
        'Account updated',
        {
          accountId,
          changes: updates,
          previousStatus: currentAccount.status,
          newStatus: updatedAccount.status,
          updatedBy
        }
      );

      this.logger.info('Account updated successfully', {
        accountId,
        updates,
        updatedBy
      });

      return updatedAccount;

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to update account', error as Error, {
        accountId,
        updates,
        updatedBy
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async searchAccounts(filters: AccountSearchFilters): Promise<{
    accounts: Account[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Build WHERE conditions
      if (filters.userId) {
        conditions.push(`user_id = $${paramIndex++}`);
        values.push(filters.userId);
      }

      if (filters.accountType) {
        conditions.push(`account_type = $${paramIndex++}`);
        values.push(filters.accountType);
      }

      if (filters.status) {
        conditions.push(`status = $${paramIndex++}`);
        values.push(filters.status);
      }

      if (filters.currency) {
        conditions.push(`currency = $${paramIndex++}`);
        values.push(filters.currency);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total records
      const countQuery = `SELECT COUNT(*) FROM accounts ${whereClause}`;
      const countResult = await this.db.query(countQuery, values);
      const total = parseInt(countResult.rows[0].count);

      // Build main query with pagination
      const page = filters.page || 1;
      const limit = Math.min(filters.limit || 20, 100);
      const offset = (page - 1) * limit;

      const sortBy = filters.sortBy || 'created_at';
      const sortOrder = filters.sortOrder || 'desc';

      const query = `
        SELECT * FROM accounts 
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

      values.push(limit, offset);

      const result = await this.db.query(query, values);
      const accounts = result.rows.map(row => this.mapRowToAccount(row));

      return {
        accounts,
        total,
        page,
        limit
      };

    } catch (error) {
      this.logger.error('Failed to search accounts', error as Error, { filters });
      throw error;
    }
  }

  async updateLastActivity(accountId: string): Promise<void> {
    try {
      const query = `
        UPDATE accounts 
        SET last_activity_at = CURRENT_TIMESTAMP 
        WHERE id = $1
      `;
      await this.db.query(query, [accountId]);

    } catch (error) {
      this.logger.error('Failed to update last activity', error as Error, { accountId });
      // Don't throw error for activity updates
    }
  }

  async getAccountHistory(accountId: string): Promise<any[]> {
    try {
      const query = `
        SELECT * FROM account_history 
        WHERE account_id = $1 
        ORDER BY created_at DESC
      `;
      const result = await this.db.query(query, [accountId]);

      return result.rows.map(row => ({
        id: row.id,
        accountId: row.account_id,
        action: row.action,
        previousStatus: row.previous_status,
        newStatus: row.new_status,
        changedBy: row.changed_by,
        reason: row.reason,
        metadata: row.metadata,
        createdAt: row.created_at
      }));

    } catch (error) {
      this.logger.error('Failed to get account history', error as Error, { accountId });
      throw error;
    }
  }

  private async generateAccountNumber(accountType: string): Promise<string> {
    const prefix = this.getAccountPrefix(accountType);
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    
    return `${prefix}${timestamp}${random}`;
  }

  private getAccountPrefix(accountType: string): string {
    const prefixes = {
      personal: 'PA',
      business: 'BA',
      system: 'SA',
      reserve: 'RA'
    };
    return prefixes[accountType as keyof typeof prefixes] || 'GA';
  }

  private async logAccountHistory(
    client: any,
    accountId: string,
    action: string,
    previousStatus: string | null,
    newStatus: string | null,
    changedBy?: string,
    reason?: string,
    metadata?: any
  ): Promise<void> {
    const query = `
      INSERT INTO account_history 
      (account_id, action, previous_status, new_status, changed_by, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    await client.query(query, [
      accountId,
      action,
      previousStatus,
      newStatus,
      changedBy,
      reason,
      JSON.stringify(metadata || {})
    ]);
  }

  private mapRowToAccount(row: any): Account {
    return {
      id: row.id,
      userId: row.user_id,
      accountNumber: row.account_number,
      accountType: row.account_type,
      status: row.status,
      currency: row.currency,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at
    };
  }
}

