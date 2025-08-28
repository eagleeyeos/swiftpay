import { Router, Request, Response } from 'express';
import { BalanceService } from '../services/balanceService';
import { AccountService } from '../services/accountService';
import { AuditLogger } from '../../../shared/libraries/logger';

export const balanceRoutes = (
  balanceService: BalanceService,
  accountService: AccountService,
  auditLogger: AuditLogger
): Router => {
  const router = Router();

  // Get balance for specific account and currency
  router.get('/:accountId/:currency', async (req: Request, res: Response) => {
    try {
      const balance = await balanceService.getBalance(req.params.accountId, req.params.currency);
      
      if (!balance) {
        return res.status(404).json({
          success: false,
          error: 'Balance not found'
        });
      }

      res.json({
        success: true,
        data: balance
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Get all balances for an account
  router.get('/:accountId', async (req: Request, res: Response) => {
    try {
      const balances = await balanceService.getAllBalances(req.params.accountId);
      
      res.json({
        success: true,
        data: balances,
        count: balances.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Update balance (credit/debit/reserve/release)
  router.post('/update', async (req: Request, res: Response) => {
    try {
      const { accountId, amount, currency, operationType, reference, description, metadata } = req.body;

      // Validate required fields
      if (!accountId || !amount || !currency || !operationType || !reference) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: accountId, amount, currency, operationType, reference'
        });
      }

      // Validate operation type
      if (!['credit', 'debit', 'reserve', 'release'].includes(operationType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid operation type. Must be: credit, debit, reserve, or release'
        });
      }

      const balance = await balanceService.updateBalance({
        accountId,
        amount,
        currency,
        operationType,
        reference,
        description: description || `${operationType} operation`,
        metadata
      }, (req as any).user?.userId);
      
      res.json({
        success: true,
        data: balance,
        message: `Balance ${operationType} completed successfully`
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Transfer balance between accounts
  router.post('/transfer', async (req: Request, res: Response) => {
    try {
      const { fromAccountId, toAccountId, amount, currency, reference, description, metadata } = req.body;

      // Validate required fields
      if (!fromAccountId || !toAccountId || !amount || !currency || !reference) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: fromAccountId, toAccountId, amount, currency, reference'
        });
      }

      // Validate accounts exist
      const fromAccount = await accountService.getAccount(fromAccountId);
      const toAccount = await accountService.getAccount(toAccountId);

      if (!fromAccount) {
        return res.status(404).json({
          success: false,
          error: 'Source account not found'
        });
      }

      if (!toAccount) {
        return res.status(404).json({
          success: false,
          error: 'Destination account not found'
        });
      }

      const result = await balanceService.transferBalance({
        fromAccountId,
        toAccountId,
        amount,
        currency,
        reference,
        description: description || 'Balance transfer',
        metadata
      }, (req as any).user?.userId);
      
      res.json({
        success: true,
        data: result,
        message: 'Transfer completed successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Reserve balance
  router.post('/reserve', async (req: Request, res: Response) => {
    try {
      const { accountId, amount, currency, reference, description } = req.body;

      if (!accountId || !amount || !currency || !reference) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: accountId, amount, currency, reference'
        });
      }

      const balance = await balanceService.reserveBalance(
        accountId,
        amount,
        currency,
        reference,
        description || 'Balance reservation',
        (req as any).user?.userId
      );
      
      res.json({
        success: true,
        data: balance,
        message: 'Balance reserved successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Release reserved balance
  router.post('/release', async (req: Request, res: Response) => {
    try {
      const { accountId, amount, currency, reference, description } = req.body;

      if (!accountId || !amount || !currency || !reference) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: accountId, amount, currency, reference'
        });
      }

      const balance = await balanceService.releaseReservedBalance(
        accountId,
        amount,
        currency,
        reference,
        description || 'Balance release',
        (req as any).user?.userId
      );
      
      res.json({
        success: true,
        data: balance,
        message: 'Reserved balance released successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Get balance history
  router.get('/:accountId/history', async (req: Request, res: Response) => {
    try {
      const currency = req.query.currency as string;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const history = await balanceService.getBalanceHistory(
        req.params.accountId,
        currency,
        limit,
        offset
      );
      
      res.json({
        success: true,
        data: history,
        count: history.length,
        pagination: {
          limit,
          offset,
          hasMore: history.length === limit
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Create daily snapshot
  router.post('/:accountId/snapshot', async (req: Request, res: Response) => {
    try {
      const date = req.body.date ? new Date(req.body.date) : new Date();
      
      await balanceService.createDailySnapshot(req.params.accountId, date);
      
      res.json({
        success: true,
        message: 'Daily snapshot created successfully',
        data: {
          accountId: req.params.accountId,
          snapshotDate: date.toISOString().split('T')[0]
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Bulk balance operations
  router.post('/bulk-update', async (req: Request, res: Response) => {
    try {
      const { operations } = req.body;

      if (!Array.isArray(operations) || operations.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Operations array is required and cannot be empty'
        });
      }

      if (operations.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'Maximum 100 operations allowed per bulk request'
        });
      }

      const results = [];
      const errors = [];

      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        
        try {
          const balance = await balanceService.updateBalance({
            accountId: operation.accountId,
            amount: operation.amount,
            currency: operation.currency,
            operationType: operation.operationType,
            reference: operation.reference,
            description: operation.description || `Bulk ${operation.operationType} operation`,
            metadata: { ...operation.metadata, bulkIndex: i }
          }, (req as any).user?.userId);

          results.push({
            index: i,
            success: true,
            data: balance
          });
        } catch (error) {
          errors.push({
            index: i,
            error: (error as Error).message,
            operation
          });
        }
      }
      
      res.json({
        success: errors.length === 0,
        data: {
          successful: results.length,
          failed: errors.length,
          results,
          errors
        },
        message: `Bulk operation completed: ${results.length} successful, ${errors.length} failed`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  return router;
};

