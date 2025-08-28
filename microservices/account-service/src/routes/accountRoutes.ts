import { Router, Request, Response } from 'express';
import { AccountService } from '../services/accountService';
import { BalanceService } from '../services/balanceService';
import { AuditLogger } from '../../../shared/libraries/logger';
import { validateSchema, accountSchemas } from '../middleware/requestValidator';

export const accountRoutes = (
  accountService: AccountService,
  balanceService: BalanceService,
  auditLogger: AuditLogger
): Router => {
  const router = Router();

  // Create new account
  router.post('/', validateSchema(accountSchemas.create), async (req: Request, res: Response) => {
    try {
      const account = await accountService.createAccount(req.body, (req as any).user?.userId);
      
      res.status(201).json({
        success: true,
        data: account,
        message: 'Account created successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Get account by ID
  router.get('/:accountId', async (req: Request, res: Response) => {
    try {
      const account = await accountService.getAccount(req.params.accountId);
      
      if (!account) {
        return res.status(404).json({
          success: false,
          error: 'Account not found'
        });
      }

      res.json({
        success: true,
        data: account
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Get account by account number
  router.get('/number/:accountNumber', async (req: Request, res: Response) => {
    try {
      const account = await accountService.getAccountByNumber(req.params.accountNumber);
      
      if (!account) {
        return res.status(404).json({
          success: false,
          error: 'Account not found'
        });
      }

      res.json({
        success: true,
        data: account
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Get user accounts
  router.get('/user/:userId', async (req: Request, res: Response) => {
    try {
      const accounts = await accountService.getUserAccounts(req.params.userId);
      
      res.json({
        success: true,
        data: accounts,
        count: accounts.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Update account
  router.put('/:accountId', validateSchema(accountSchemas.update), async (req: Request, res: Response) => {
    try {
      const account = await accountService.updateAccount(
        req.params.accountId,
        req.body,
        (req as any).user?.userId
      );
      
      res.json({
        success: true,
        data: account,
        message: 'Account updated successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Search accounts
  router.get('/', validateSchema(accountSchemas.search, 'query'), async (req: Request, res: Response) => {
    try {
      const result = await accountService.searchAccounts(req.query as any);
      
      res.json({
        success: true,
        data: result.accounts,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil(result.total / result.limit)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Get account history
  router.get('/:accountId/history', async (req: Request, res: Response) => {
    try {
      const history = await accountService.getAccountHistory(req.params.accountId);
      
      res.json({
        success: true,
        data: history,
        count: history.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Get account with balances
  router.get('/:accountId/full', async (req: Request, res: Response) => {
    try {
      const account = await accountService.getAccount(req.params.accountId);
      
      if (!account) {
        return res.status(404).json({
          success: false,
          error: 'Account not found'
        });
      }

      const balances = await balanceService.getAllBalances(req.params.accountId);
      
      res.json({
        success: true,
        data: {
          ...account,
          balances
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Update last activity
  router.post('/:accountId/activity', async (req: Request, res: Response) => {
    try {
      await accountService.updateLastActivity(req.params.accountId);
      
      res.json({
        success: true,
        message: 'Activity updated successfully'
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

// Validation schemas
const accountSchemas = {
  create: {
    userId: { type: 'string', required: true },
    accountType: { 
      type: 'string', 
      required: true,
      enum: ['personal', 'business', 'system', 'reserve']
    },
    currency: { type: 'string', required: true, length: 3 },
    metadata: { type: 'object', required: false }
  },
  
  update: {
    status: { 
      type: 'string', 
      required: false,
      enum: ['active', 'inactive', 'suspended', 'closed']
    },
    metadata: { type: 'object', required: false }
  },
  
  search: {
    userId: { type: 'string', required: false },
    accountType: { type: 'string', required: false },
    status: { type: 'string', required: false },
    currency: { type: 'string', required: false },
    page: { type: 'number', required: false, min: 1 },
    limit: { type: 'number', required: false, min: 1, max: 100 },
    sortBy: { type: 'string', required: false },
    sortOrder: { type: 'string', required: false, enum: ['asc', 'desc'] }
  }
};

