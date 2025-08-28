import { Pool } from 'pg';
import Decimal from 'decimal.js';

import { DatabaseManager } from '../../../shared/config/database';
import { Logger, AuditLogger } from '../../../shared/libraries/logger';

export interface Balance {
  id: string;
  accountId: string;
  currency: string;
  availableBalance: string;
  pendingBalance: string;
  totalBalance: string;
  reservedBalance: string;
  lastUpdated: Date;
}

export interface BalanceOperation {
  id: string;
  accountId: string;
  operationType: 'credit' | 'debit' | 'reserve' | 'release' | 'transfer';
  amount: string;
  currency: string;
  reference: string;
  description: string;
  metadata: any;
  createdAt: Date;
  processedAt?: Date;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
}

export interface BalanceUpdateRequest {
  accountId: string;
  amount: string;
  currency: string;
  operationType: 'credit' | 'debit' | 'reserve' | 'release';
  reference: string;
  description: string;
  metadata?: any;
}

export interface TransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  currency: string;
  reference: string;
  description: string;
  metadata?: any;
}

export class BalanceService {
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
    this.logger.info('BalanceService initialized');
  }

  private async createTables(): Promise<void> {
    const createTablesQuery = `
      CREATE TABLE IF NOT EXISTS balances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        currency VARCHAR(10) NOT NULL,
        available_balance DECIMAL(20,8) DEFAULT 0,
        pending_balance DECIMAL(20,8) DEFAULT 0,
        total_balance DECIMAL(20,8) DEFAULT 0,
        reserved_balance DECIMAL(20,8) DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, currency)
      );

      CREATE INDEX IF NOT EXISTS idx_balances_account_currency ON balances(account_id, currency);

      CREATE TABLE IF NOT EXISTS balance_operations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        operation_type VARCHAR(20) NOT NULL CHECK (operation_type IN ('credit', 'debit', 'reserve', 'release', 'transfer')),
        amount DECIMAL(20,8) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        reference VARCHAR(100) NOT NULL,
        description TEXT,
        metadata JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_balance_operations_account ON balance_operations(account_id);
      CREATE INDEX IF NOT EXISTS idx_balance_operations_reference ON balance_operations(reference);
      CREATE INDEX IF NOT EXISTS idx_balance_operations_status ON balance_operations(status);
      CREATE INDEX IF NOT EXISTS idx_balance_operations_created_at ON balance_operations(created_at);

      CREATE TABLE IF NOT EXISTS balance_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        currency VARCHAR(10) NOT NULL,
        available_balance DECIMAL(20,8) NOT NULL,
        pending_balance DECIMAL(20,8) NOT NULL,
        total_balance DECIMAL(20,8) NOT NULL,
        reserved_balance DECIMAL(20,8) NOT NULL,
        snapshot_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, currency, snapshot_date)
      );

      CREATE INDEX IF NOT EXISTS idx_balance_snapshots_account_date ON balance_snapshots(account_id, snapshot_date);
    `;

    await this.db.query(createTablesQuery);
  }

  async getBalance(accountId: string, currency: string): Promise<Balance | null> {
    try {
      const query = `
        SELECT * FROM balances 
        WHERE account_id = $1 AND currency = $2
      `;
      const result = await this.db.query(query, [accountId, currency]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToBalance(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to get balance', error as Error, { accountId, currency });
      throw error;
    }
  }

  async getAllBalances(accountId: string): Promise<Balance[]> {
    try {
      const query = `
        SELECT * FROM balances 
        WHERE account_id = $1 
        ORDER BY currency
      `;
      const result = await this.db.query(query, [accountId]);

      return result.rows.map(row => this.mapRowToBalance(row));

    } catch (error) {
      this.logger.error('Failed to get all balances', error as Error, { accountId });
      throw error;
    }
  }

  async updateBalance(request: BalanceUpdateRequest, updatedBy?: string): Promise<Balance> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Validate amount
      const amount = new Decimal(request.amount);
      if (amount.isZero()) {
        throw new Error('Amount cannot be zero');
      }

      // Get or create balance record
      let balance = await this.getOrCreateBalance(client, request.accountId, request.currency);

      // Validate operation
      await this.validateBalanceOperation(balance, request.operationType, amount);

      // Create operation record
      const operationId = await this.createBalanceOperation(client, request);

      // Update balance based on operation type
      balance = await this.applyBalanceOperation(client, balance, request.operationType, amount);

      // Mark operation as completed
      await this.completeBalanceOperation(client, operationId);

      await client.query('COMMIT');

      this.auditLogger.logUserAction(
        updatedBy || 'system',
        'Balance updated',
        {
          accountId: request.accountId,
          operationType: request.operationType,
          amount: request.amount,
          currency: request.currency,
          reference: request.reference,
          newBalance: balance.availableBalance
        }
      );

      this.logger.info('Balance updated successfully', {
        accountId: request.accountId,
        operationType: request.operationType,
        amount: request.amount,
        currency: request.currency,
        reference: request.reference
      });

      return balance;

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to update balance', error as Error, request);
      throw error;
    } finally {
      client.release();
    }
  }

  async transferBalance(request: TransferRequest, initiatedBy?: string): Promise<{
    fromBalance: Balance;
    toBalance: Balance;
    operationId: string;
  }> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      const amount = new Decimal(request.amount);
      if (amount.lte(0)) {
        throw new Error('Transfer amount must be positive');
      }

      // Get balances
      const fromBalance = await this.getOrCreateBalance(client, request.fromAccountId, request.currency);
      const toBalance = await this.getOrCreateBalance(client, request.toAccountId, request.currency);

      // Validate sufficient balance
      const availableAmount = new Decimal(fromBalance.availableBalance);
      if (availableAmount.lt(amount)) {
        throw new Error('Insufficient balance for transfer');
      }

      // Create transfer operation
      const transferId = await this.createTransferOperation(client, request);

      // Debit from source account
      const updatedFromBalance = await this.applyBalanceOperation(
        client, 
        fromBalance, 
        'debit', 
        amount
      );

      // Credit to destination account
      const updatedToBalance = await this.applyBalanceOperation(
        client, 
        toBalance, 
        'credit', 
        amount
      );

      // Mark transfer as completed
      await this.completeBalanceOperation(client, transferId);

      await client.query('COMMIT');

      this.auditLogger.logUserAction(
        initiatedBy || 'system',
        'Balance transfer',
        {
          fromAccountId: request.fromAccountId,
          toAccountId: request.toAccountId,
          amount: request.amount,
          currency: request.currency,
          reference: request.reference,
          transferId
        }
      );

      this.logger.info('Balance transfer completed', {
        fromAccountId: request.fromAccountId,
        toAccountId: request.toAccountId,
        amount: request.amount,
        currency: request.currency,
        reference: request.reference,
        transferId
      });

      return {
        fromBalance: updatedFromBalance,
        toBalance: updatedToBalance,
        operationId: transferId
      };

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to transfer balance', error as Error, request);
      throw error;
    } finally {
      client.release();
    }
  }

  async reserveBalance(
    accountId: string, 
    amount: string, 
    currency: string, 
    reference: string,
    description: string,
    reservedBy?: string
  ): Promise<Balance> {
    const request: BalanceUpdateRequest = {
      accountId,
      amount,
      currency,
      operationType: 'reserve',
      reference,
      description,
      metadata: { reservedBy }
    };

    return this.updateBalance(request, reservedBy);
  }

  async releaseReservedBalance(
    accountId: string, 
    amount: string, 
    currency: string, 
    reference: string,
    description: string,
    releasedBy?: string
  ): Promise<Balance> {
    const request: BalanceUpdateRequest = {
      accountId,
      amount,
      currency,
      operationType: 'release',
      reference,
      description,
      metadata: { releasedBy }
    };

    return this.updateBalance(request, releasedBy);
  }

  async getBalanceHistory(
    accountId: string, 
    currency?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<BalanceOperation[]> {
    try {
      let query = `
        SELECT * FROM balance_operations 
        WHERE account_id = $1
      `;
      const params: any[] = [accountId];

      if (currency) {
        query += ` AND currency = $2`;
        params.push(currency);
      }

      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await this.db.query(query, params);

      return result.rows.map(row => this.mapRowToBalanceOperation(row));

    } catch (error) {
      this.logger.error('Failed to get balance history', error as Error, { accountId, currency });
      throw error;
    }
  }

  async createDailySnapshot(accountId: string, date: Date = new Date()): Promise<void> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      const balances = await this.getAllBalances(accountId);

      for (const balance of balances) {
        const insertQuery = `
          INSERT INTO balance_snapshots 
          (account_id, currency, available_balance, pending_balance, total_balance, reserved_balance, snapshot_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (account_id, currency, snapshot_date) 
          DO UPDATE SET
            available_balance = EXCLUDED.available_balance,
            pending_balance = EXCLUDED.pending_balance,
            total_balance = EXCLUDED.total_balance,
            reserved_balance = EXCLUDED.reserved_balance,
            created_at = CURRENT_TIMESTAMP
        `;

        await client.query(insertQuery, [
          accountId,
          balance.currency,
          balance.availableBalance,
          balance.pendingBalance,
          balance.totalBalance,
          balance.reservedBalance,
          date.toISOString().split('T')[0] // YYYY-MM-DD format
        ]);
      }

      await client.query('COMMIT');

      this.logger.info('Daily balance snapshot created', { accountId, date });

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to create daily snapshot', error as Error, { accountId, date });
      throw error;
    } finally {
      client.release();
    }
  }

  private async getOrCreateBalance(client: any, accountId: string, currency: string): Promise<Balance> {
    // Try to get existing balance
    const selectQuery = `
      SELECT * FROM balances 
      WHERE account_id = $1 AND currency = $2
    `;
    const selectResult = await client.query(selectQuery, [accountId, currency]);

    if (selectResult.rows.length > 0) {
      return this.mapRowToBalance(selectResult.rows[0]);
    }

    // Create new balance record
    const insertQuery = `
      INSERT INTO balances (account_id, currency)
      VALUES ($1, $2)
      RETURNING *
    `;
    const insertResult = await client.query(insertQuery, [accountId, currency]);

    return this.mapRowToBalance(insertResult.rows[0]);
  }

  private async validateBalanceOperation(
    balance: Balance, 
    operationType: string, 
    amount: Decimal
  ): Promise<void> {
    const availableBalance = new Decimal(balance.availableBalance);
    const reservedBalance = new Decimal(balance.reservedBalance);

    switch (operationType) {
      case 'debit':
        if (availableBalance.lt(amount)) {
          throw new Error('Insufficient available balance');
        }
        break;
      case 'release':
        if (reservedBalance.lt(amount)) {
          throw new Error('Insufficient reserved balance');
        }
        break;
      case 'reserve':
        if (availableBalance.lt(amount)) {
          throw new Error('Insufficient balance to reserve');
        }
        break;
    }
  }

  private async createBalanceOperation(client: any, request: BalanceUpdateRequest): Promise<string> {
    const insertQuery = `
      INSERT INTO balance_operations 
      (account_id, operation_type, amount, currency, reference, description, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;

    const result = await client.query(insertQuery, [
      request.accountId,
      request.operationType,
      request.amount,
      request.currency,
      request.reference,
      request.description,
      JSON.stringify(request.metadata || {})
    ]);

    return result.rows[0].id;
  }

  private async createTransferOperation(client: any, request: TransferRequest): Promise<string> {
    const insertQuery = `
      INSERT INTO balance_operations 
      (account_id, operation_type, amount, currency, reference, description, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;

    const result = await client.query(insertQuery, [
      request.fromAccountId,
      'transfer',
      request.amount,
      request.currency,
      request.reference,
      request.description,
      JSON.stringify({
        ...request.metadata,
        toAccountId: request.toAccountId,
        transferType: 'outbound'
      })
    ]);

    return result.rows[0].id;
  }

  private async applyBalanceOperation(
    client: any, 
    balance: Balance, 
    operationType: string, 
    amount: Decimal
  ): Promise<Balance> {
    let availableBalance = new Decimal(balance.availableBalance);
    let reservedBalance = new Decimal(balance.reservedBalance);

    switch (operationType) {
      case 'credit':
        availableBalance = availableBalance.plus(amount);
        break;
      case 'debit':
        availableBalance = availableBalance.minus(amount);
        break;
      case 'reserve':
        availableBalance = availableBalance.minus(amount);
        reservedBalance = reservedBalance.plus(amount);
        break;
      case 'release':
        availableBalance = availableBalance.plus(amount);
        reservedBalance = reservedBalance.minus(amount);
        break;
    }

    const totalBalance = availableBalance.plus(reservedBalance);

    const updateQuery = `
      UPDATE balances 
      SET 
        available_balance = $1,
        reserved_balance = $2,
        total_balance = $3,
        last_updated = CURRENT_TIMESTAMP
      WHERE account_id = $4 AND currency = $5
      RETURNING *
    `;

    const result = await client.query(updateQuery, [
      availableBalance.toString(),
      reservedBalance.toString(),
      totalBalance.toString(),
      balance.accountId,
      balance.currency
    ]);

    return this.mapRowToBalance(result.rows[0]);
  }

  private async completeBalanceOperation(client: any, operationId: string): Promise<void> {
    const updateQuery = `
      UPDATE balance_operations 
      SET status = 'completed', processed_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;

    await client.query(updateQuery, [operationId]);
  }

  private mapRowToBalance(row: any): Balance {
    return {
      id: row.id,
      accountId: row.account_id,
      currency: row.currency,
      availableBalance: row.available_balance,
      pendingBalance: row.pending_balance,
      totalBalance: row.total_balance,
      reservedBalance: row.reserved_balance,
      lastUpdated: row.last_updated
    };
  }

  private mapRowToBalanceOperation(row: any): BalanceOperation {
    return {
      id: row.id,
      accountId: row.account_id,
      operationType: row.operation_type,
      amount: row.amount,
      currency: row.currency,
      reference: row.reference,
      description: row.description,
      metadata: row.metadata,
      createdAt: row.created_at,
      processedAt: row.processed_at,
      status: row.status
    };
  }
}

