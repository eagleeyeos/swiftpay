import { Router, Request, Response } from 'express';
import { ProfileService } from '../services/profileService';
import { AccountService } from '../services/accountService';
import { AuditLogger } from '../../../shared/libraries/logger';

export const profileRoutes = (
  profileService: ProfileService,
  accountService: AccountService,
  auditLogger: AuditLogger
): Router => {
  const router = Router();

  // Create user profile
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { userId, personalInfo, contactInfo, address } = req.body;

      // Validate required fields
      if (!userId || !personalInfo || !contactInfo || !address) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: userId, personalInfo, contactInfo, address'
        });
      }

      const profile = await profileService.createProfile({
        userId,
        personalInfo,
        contactInfo,
        address
      }, (req as any).user?.userId);
      
      res.status(201).json({
        success: true,
        data: profile,
        message: 'Profile created successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Get user profile
  router.get('/:userId', async (req: Request, res: Response) => {
    try {
      const profile = await profileService.getProfile(req.params.userId);
      
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'Profile not found'
        });
      }

      res.json({
        success: true,
        data: profile
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Update user profile
  router.put('/:userId', async (req: Request, res: Response) => {
    try {
      const { personalInfo, contactInfo, address, preferences, metadata } = req.body;

      const profile = await profileService.updateProfile(
        req.params.userId,
        {
          personalInfo,
          contactInfo,
          address,
          preferences,
          metadata
        },
        (req as any).user?.userId
      );
      
      res.json({
        success: true,
        data: profile,
        message: 'Profile updated successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Update KYC status
  router.put('/:userId/kyc-status', async (req: Request, res: Response) => {
    try {
      const { status, level, rejectionReason } = req.body;

      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status is required'
        });
      }

      if (!['pending', 'in_review', 'verified', 'rejected'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Must be: pending, in_review, verified, or rejected'
        });
      }

      const profile = await profileService.updateKYCStatus(
        req.params.userId,
        status,
        level,
        (req as any).user?.userId,
        rejectionReason
      );
      
      res.json({
        success: true,
        data: profile,
        message: 'KYC status updated successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Add KYC document
  router.post('/:userId/kyc-documents', async (req: Request, res: Response) => {
    try {
      const { type, fileName, fileUrl } = req.body;

      if (!type || !fileName || !fileUrl) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: type, fileName, fileUrl'
        });
      }

      if (!['passport', 'drivers_license', 'national_id', 'utility_bill', 'bank_statement'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid document type'
        });
      }

      const profile = await profileService.addKYCDocument(req.params.userId, {
        type,
        fileName,
        fileUrl
      });
      
      res.status(201).json({
        success: true,
        data: profile,
        message: 'KYC document added successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Update KYC document status
  router.put('/:userId/kyc-documents/:documentId', async (req: Request, res: Response) => {
    try {
      const { status, rejectionReason } = req.body;

      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status is required'
        });
      }

      if (!['pending', 'verified', 'rejected'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Must be: pending, verified, or rejected'
        });
      }

      const profile = await profileService.updateKYCDocument(
        req.params.userId,
        req.params.documentId,
        status,
        rejectionReason
      );
      
      res.json({
        success: true,
        data: profile,
        message: 'KYC document status updated successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Search profiles
  router.get('/', async (req: Request, res: Response) => {
    try {
      const {
        kycStatus,
        country,
        createdAfter,
        createdBefore,
        page = 1,
        limit = 20
      } = req.query;

      const filters: any = {
        page: parseInt(page as string),
        limit: Math.min(parseInt(limit as string), 100)
      };

      if (kycStatus) filters.kycStatus = kycStatus;
      if (country) filters.country = country;
      if (createdAfter) filters.createdAfter = new Date(createdAfter as string);
      if (createdBefore) filters.createdBefore = new Date(createdBefore as string);

      const result = await profileService.searchProfiles(filters);
      
      res.json({
        success: true,
        data: result.profiles,
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

  // Delete user profile
  router.delete('/:userId', async (req: Request, res: Response) => {
    try {
      await profileService.deleteProfile(req.params.userId, (req as any).user?.userId);
      
      res.json({
        success: true,
        message: 'Profile deleted successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Get profile with accounts
  router.get('/:userId/full', async (req: Request, res: Response) => {
    try {
      const profile = await profileService.getProfile(req.params.userId);
      
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'Profile not found'
        });
      }

      const accounts = await accountService.getUserAccounts(req.params.userId);
      
      res.json({
        success: true,
        data: {
          profile,
          accounts
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Update profile preferences
  router.put('/:userId/preferences', async (req: Request, res: Response) => {
    try {
      const { notifications, security, trading } = req.body;

      const profile = await profileService.updateProfile(
        req.params.userId,
        {
          preferences: {
            notifications,
            security,
            trading
          }
        },
        (req as any).user?.userId
      );
      
      res.json({
        success: true,
        data: profile,
        message: 'Preferences updated successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Get KYC statistics
  router.get('/stats/kyc', async (req: Request, res: Response) => {
    try {
      const [pending, inReview, verified, rejected] = await Promise.all([
        profileService.searchProfiles({ kycStatus: 'pending', limit: 1 }),
        profileService.searchProfiles({ kycStatus: 'in_review', limit: 1 }),
        profileService.searchProfiles({ kycStatus: 'verified', limit: 1 }),
        profileService.searchProfiles({ kycStatus: 'rejected', limit: 1 })
      ]);

      res.json({
        success: true,
        data: {
          pending: pending.total,
          inReview: inReview.total,
          verified: verified.total,
          rejected: rejected.total,
          total: pending.total + inReview.total + verified.total + rejected.total
        }
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

