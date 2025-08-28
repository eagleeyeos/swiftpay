import { Pool } from 'pg';
import { MongoClient, Db, Collection } from 'mongodb';

import { DatabaseManager } from '../../../shared/config/database';
import { Logger, AuditLogger } from '../../../shared/libraries/logger';

export interface UserProfile {
  id: string;
  userId: string;
  personalInfo: {
    firstName: string;
    lastName: string;
    middleName?: string;
    dateOfBirth: Date;
    nationality: string;
    gender?: 'male' | 'female' | 'other';
  };
  contactInfo: {
    email: string;
    phone: string;
    alternatePhone?: string;
    preferredLanguage: string;
    timezone: string;
  };
  address: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  kycInfo: {
    status: 'pending' | 'in_review' | 'verified' | 'rejected';
    level: 'basic' | 'intermediate' | 'advanced';
    documents: KYCDocument[];
    verifiedAt?: Date;
    verifiedBy?: string;
    rejectionReason?: string;
  };
  preferences: {
    notifications: {
      email: boolean;
      sms: boolean;
      push: boolean;
    };
    security: {
      twoFactorEnabled: boolean;
      biometricEnabled: boolean;
      sessionTimeout: number;
    };
    trading: {
      riskTolerance: 'low' | 'medium' | 'high';
      autoInvest: boolean;
    };
  };
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface KYCDocument {
  id: string;
  type: 'passport' | 'drivers_license' | 'national_id' | 'utility_bill' | 'bank_statement';
  fileName: string;
  fileUrl: string;
  status: 'pending' | 'verified' | 'rejected';
  uploadedAt: Date;
  verifiedAt?: Date;
  rejectionReason?: string;
}

export interface CreateProfileRequest {
  userId: string;
  personalInfo: {
    firstName: string;
    lastName: string;
    middleName?: string;
    dateOfBirth: Date;
    nationality: string;
    gender?: 'male' | 'female' | 'other';
  };
  contactInfo: {
    email: string;
    phone: string;
    alternatePhone?: string;
    preferredLanguage?: string;
    timezone?: string;
  };
  address: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}

export interface UpdateProfileRequest {
  personalInfo?: Partial<UserProfile['personalInfo']>;
  contactInfo?: Partial<UserProfile['contactInfo']>;
  address?: Partial<UserProfile['address']>;
  preferences?: Partial<UserProfile['preferences']>;
  metadata?: any;
}

export class ProfileService {
  private db: Pool;
  private mongodb: MongoClient;
  private profilesCollection: Collection;
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
    this.mongodb = this.dbManager.getMongoClient();
    
    const mongoDb = this.mongodb.db('swiftpayme');
    this.profilesCollection = mongoDb.collection('user_profiles');

    // Create indexes
    await this.createIndexes();
    
    this.logger.info('ProfileService initialized');
  }

  private async createIndexes(): Promise<void> {
    try {
      // MongoDB indexes for profiles
      await this.profilesCollection.createIndex({ userId: 1 }, { unique: true });
      await this.profilesCollection.createIndex({ 'contactInfo.email': 1 }, { unique: true });
      await this.profilesCollection.createIndex({ 'contactInfo.phone': 1 });
      await this.profilesCollection.createIndex({ 'kycInfo.status': 1 });
      await this.profilesCollection.createIndex({ createdAt: 1 });

      this.logger.info('Profile indexes created successfully');
    } catch (error) {
      this.logger.error('Failed to create profile indexes', error as Error);
      throw error;
    }
  }

  async createProfile(request: CreateProfileRequest, createdBy?: string): Promise<UserProfile> {
    try {
      // Check if profile already exists
      const existingProfile = await this.getProfile(request.userId);
      if (existingProfile) {
        throw new Error('Profile already exists for this user');
      }

      const profile: UserProfile = {
        id: this.generateProfileId(),
        userId: request.userId,
        personalInfo: request.personalInfo,
        contactInfo: {
          ...request.contactInfo,
          preferredLanguage: request.contactInfo.preferredLanguage || 'en',
          timezone: request.contactInfo.timezone || 'UTC'
        },
        address: request.address,
        kycInfo: {
          status: 'pending',
          level: 'basic',
          documents: []
        },
        preferences: {
          notifications: {
            email: true,
            sms: true,
            push: true
          },
          security: {
            twoFactorEnabled: false,
            biometricEnabled: false,
            sessionTimeout: 900000 // 15 minutes
          },
          trading: {
            riskTolerance: 'medium',
            autoInvest: false
          }
        },
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await this.profilesCollection.insertOne(profile);

      this.auditLogger.logUserAction(
        request.userId,
        'Profile created',
        {
          profileId: profile.id,
          createdBy
        }
      );

      this.logger.info('User profile created successfully', {
        userId: request.userId,
        profileId: profile.id
      });

      return profile;

    } catch (error) {
      this.logger.error('Failed to create profile', error as Error, {
        userId: request.userId
      });
      throw error;
    }
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    try {
      const profile = await this.profilesCollection.findOne({ userId });
      return profile as UserProfile | null;

    } catch (error) {
      this.logger.error('Failed to get profile', error as Error, { userId });
      throw error;
    }
  }

  async updateProfile(
    userId: string, 
    updates: UpdateProfileRequest, 
    updatedBy?: string
  ): Promise<UserProfile> {
    try {
      const existingProfile = await this.getProfile(userId);
      if (!existingProfile) {
        throw new Error('Profile not found');
      }

      const updateDoc: any = {
        updatedAt: new Date()
      };

      // Build update document
      if (updates.personalInfo) {
        Object.keys(updates.personalInfo).forEach(key => {
          updateDoc[`personalInfo.${key}`] = (updates.personalInfo as any)[key];
        });
      }

      if (updates.contactInfo) {
        Object.keys(updates.contactInfo).forEach(key => {
          updateDoc[`contactInfo.${key}`] = (updates.contactInfo as any)[key];
        });
      }

      if (updates.address) {
        Object.keys(updates.address).forEach(key => {
          updateDoc[`address.${key}`] = (updates.address as any)[key];
        });
      }

      if (updates.preferences) {
        Object.keys(updates.preferences).forEach(key => {
          updateDoc[`preferences.${key}`] = (updates.preferences as any)[key];
        });
      }

      if (updates.metadata) {
        updateDoc.metadata = { ...existingProfile.metadata, ...updates.metadata };
      }

      await this.profilesCollection.updateOne(
        { userId },
        { $set: updateDoc }
      );

      const updatedProfile = await this.getProfile(userId);

      this.auditLogger.logUserAction(
        userId,
        'Profile updated',
        {
          updates,
          updatedBy
        }
      );

      this.logger.info('User profile updated successfully', {
        userId,
        updates: Object.keys(updates)
      });

      return updatedProfile!;

    } catch (error) {
      this.logger.error('Failed to update profile', error as Error, {
        userId,
        updates
      });
      throw error;
    }
  }

  async updateKYCStatus(
    userId: string,
    status: 'pending' | 'in_review' | 'verified' | 'rejected',
    level?: 'basic' | 'intermediate' | 'advanced',
    verifiedBy?: string,
    rejectionReason?: string
  ): Promise<UserProfile> {
    try {
      const updateDoc: any = {
        'kycInfo.status': status,
        updatedAt: new Date()
      };

      if (level) {
        updateDoc['kycInfo.level'] = level;
      }

      if (status === 'verified') {
        updateDoc['kycInfo.verifiedAt'] = new Date();
        updateDoc['kycInfo.verifiedBy'] = verifiedBy;
      }

      if (status === 'rejected' && rejectionReason) {
        updateDoc['kycInfo.rejectionReason'] = rejectionReason;
      }

      await this.profilesCollection.updateOne(
        { userId },
        { $set: updateDoc }
      );

      const updatedProfile = await this.getProfile(userId);

      this.auditLogger.logUserAction(
        userId,
        'KYC status updated',
        {
          status,
          level,
          verifiedBy,
          rejectionReason
        }
      );

      this.logger.info('KYC status updated', {
        userId,
        status,
        level
      });

      return updatedProfile!;

    } catch (error) {
      this.logger.error('Failed to update KYC status', error as Error, {
        userId,
        status
      });
      throw error;
    }
  }

  async addKYCDocument(
    userId: string,
    document: Omit<KYCDocument, 'id' | 'uploadedAt' | 'status'>
  ): Promise<UserProfile> {
    try {
      const kycDocument: KYCDocument = {
        id: this.generateDocumentId(),
        ...document,
        status: 'pending',
        uploadedAt: new Date()
      };

      await this.profilesCollection.updateOne(
        { userId },
        { 
          $push: { 'kycInfo.documents': kycDocument },
          $set: { updatedAt: new Date() }
        }
      );

      const updatedProfile = await this.getProfile(userId);

      this.auditLogger.logUserAction(
        userId,
        'KYC document uploaded',
        {
          documentId: kycDocument.id,
          documentType: document.type,
          fileName: document.fileName
        }
      );

      this.logger.info('KYC document added', {
        userId,
        documentId: kycDocument.id,
        documentType: document.type
      });

      return updatedProfile!;

    } catch (error) {
      this.logger.error('Failed to add KYC document', error as Error, {
        userId,
        documentType: document.type
      });
      throw error;
    }
  }

  async updateKYCDocument(
    userId: string,
    documentId: string,
    status: 'pending' | 'verified' | 'rejected',
    rejectionReason?: string
  ): Promise<UserProfile> {
    try {
      const updateDoc: any = {
        'kycInfo.documents.$.status': status,
        updatedAt: new Date()
      };

      if (status === 'verified') {
        updateDoc['kycInfo.documents.$.verifiedAt'] = new Date();
      }

      if (status === 'rejected' && rejectionReason) {
        updateDoc['kycInfo.documents.$.rejectionReason'] = rejectionReason;
      }

      await this.profilesCollection.updateOne(
        { userId, 'kycInfo.documents.id': documentId },
        { $set: updateDoc }
      );

      const updatedProfile = await this.getProfile(userId);

      this.auditLogger.logUserAction(
        userId,
        'KYC document status updated',
        {
          documentId,
          status,
          rejectionReason
        }
      );

      this.logger.info('KYC document status updated', {
        userId,
        documentId,
        status
      });

      return updatedProfile!;

    } catch (error) {
      this.logger.error('Failed to update KYC document', error as Error, {
        userId,
        documentId,
        status
      });
      throw error;
    }
  }

  async searchProfiles(filters: {
    kycStatus?: string;
    country?: string;
    createdAfter?: Date;
    createdBefore?: Date;
    page?: number;
    limit?: number;
  }): Promise<{
    profiles: UserProfile[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const query: any = {};

      if (filters.kycStatus) {
        query['kycInfo.status'] = filters.kycStatus;
      }

      if (filters.country) {
        query['address.country'] = filters.country;
      }

      if (filters.createdAfter || filters.createdBefore) {
        query.createdAt = {};
        if (filters.createdAfter) {
          query.createdAt.$gte = filters.createdAfter;
        }
        if (filters.createdBefore) {
          query.createdAt.$lte = filters.createdBefore;
        }
      }

      const page = filters.page || 1;
      const limit = Math.min(filters.limit || 20, 100);
      const skip = (page - 1) * limit;

      const [profiles, total] = await Promise.all([
        this.profilesCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        this.profilesCollection.countDocuments(query)
      ]);

      return {
        profiles: profiles as UserProfile[],
        total,
        page,
        limit
      };

    } catch (error) {
      this.logger.error('Failed to search profiles', error as Error, { filters });
      throw error;
    }
  }

  async deleteProfile(userId: string, deletedBy?: string): Promise<void> {
    try {
      const result = await this.profilesCollection.deleteOne({ userId });

      if (result.deletedCount === 0) {
        throw new Error('Profile not found');
      }

      this.auditLogger.logUserAction(
        userId,
        'Profile deleted',
        {
          deletedBy
        }
      );

      this.logger.info('User profile deleted', {
        userId,
        deletedBy
      });

    } catch (error) {
      this.logger.error('Failed to delete profile', error as Error, {
        userId
      });
      throw error;
    }
  }

  private generateProfileId(): string {
    return `profile_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  private generateDocumentId(): string {
    return `doc_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

