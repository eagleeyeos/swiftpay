import { Logger } from '../../../shared/libraries/logger';

export interface NotificationRequest {
  userId: string;
  type: 'email' | 'sms' | 'push';
  template: string;
  data: any;
  priority: 'low' | 'medium' | 'high';
}

export interface NotificationHistory {
  id: string;
  userId: string;
  type: string;
  template: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt?: Date;
  error?: string;
  createdAt: Date;
}

export class NotificationService {
  private logger: Logger;
  private notificationQueue: NotificationRequest[] = [];

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    // Initialize notification processing
    this.startNotificationProcessor();
    this.logger.info('NotificationService initialized');
  }

  async sendAccountCreatedNotification(userId: string, accountData: any): Promise<void> {
    await this.queueNotification({
      userId,
      type: 'email',
      template: 'account_created',
      data: accountData,
      priority: 'high'
    });
  }

  async sendBalanceUpdateNotification(userId: string, balanceData: any): Promise<void> {
    await this.queueNotification({
      userId,
      type: 'push',
      template: 'balance_updated',
      data: balanceData,
      priority: 'medium'
    });
  }

  async sendKYCStatusNotification(userId: string, kycData: any): Promise<void> {
    await this.queueNotification({
      userId,
      type: 'email',
      template: 'kyc_status_updated',
      data: kycData,
      priority: 'high'
    });
  }

  async sendProfileUpdateNotification(userId: string, profileData: any): Promise<void> {
    await this.queueNotification({
      userId,
      type: 'email',
      template: 'profile_updated',
      data: profileData,
      priority: 'low'
    });
  }

  async sendSecurityAlertNotification(userId: string, alertData: any): Promise<void> {
    await this.queueNotification({
      userId,
      type: 'email',
      template: 'security_alert',
      data: alertData,
      priority: 'high'
    });

    // Also send SMS for security alerts
    await this.queueNotification({
      userId,
      type: 'sms',
      template: 'security_alert_sms',
      data: alertData,
      priority: 'high'
    });
  }

  private async queueNotification(request: NotificationRequest): Promise<void> {
    this.notificationQueue.push(request);
    this.logger.info('Notification queued', {
      userId: request.userId,
      type: request.type,
      template: request.template,
      priority: request.priority
    });
  }

  private startNotificationProcessor(): void {
    // Process notifications every 5 seconds
    setInterval(async () => {
      await this.processNotificationQueue();
    }, 5000);
  }

  private async processNotificationQueue(): Promise<void> {
    if (this.notificationQueue.length === 0) {
      return;
    }

    // Sort by priority (high -> medium -> low)
    this.notificationQueue.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });

    // Process up to 10 notifications at a time
    const batch = this.notificationQueue.splice(0, 10);

    for (const notification of batch) {
      try {
        await this.processNotification(notification);
      } catch (error) {
        this.logger.error('Failed to process notification', error as Error, {
          userId: notification.userId,
          type: notification.type,
          template: notification.template
        });
      }
    }
  }

  private async processNotification(request: NotificationRequest): Promise<void> {
    try {
      // In a real implementation, this would integrate with:
      // - Email service (SendGrid, AWS SES, etc.)
      // - SMS service (Twilio, AWS SNS, etc.)
      // - Push notification service (Firebase, AWS SNS, etc.)

      switch (request.type) {
        case 'email':
          await this.sendEmail(request);
          break;
        case 'sms':
          await this.sendSMS(request);
          break;
        case 'push':
          await this.sendPushNotification(request);
          break;
        default:
          throw new Error(`Unsupported notification type: ${request.type}`);
      }

      this.logger.info('Notification sent successfully', {
        userId: request.userId,
        type: request.type,
        template: request.template
      });

    } catch (error) {
      this.logger.error('Failed to send notification', error as Error, {
        userId: request.userId,
        type: request.type,
        template: request.template
      });
      throw error;
    }
  }

  private async sendEmail(request: NotificationRequest): Promise<void> {
    // Mock email sending
    this.logger.info('Email notification sent', {
      userId: request.userId,
      template: request.template,
      data: request.data
    });

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private async sendSMS(request: NotificationRequest): Promise<void> {
    // Mock SMS sending
    this.logger.info('SMS notification sent', {
      userId: request.userId,
      template: request.template,
      data: request.data
    });

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  private async sendPushNotification(request: NotificationRequest): Promise<void> {
    // Mock push notification sending
    this.logger.info('Push notification sent', {
      userId: request.userId,
      template: request.template,
      data: request.data
    });

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Template methods for different notification types
  private getEmailTemplate(template: string, data: any): { subject: string; body: string } {
    const templates = {
      account_created: {
        subject: 'Welcome to SwiftPayme - Account Created',
        body: `Dear ${data.firstName}, your SwiftPayme account has been successfully created. Account Number: ${data.accountNumber}`
      },
      balance_updated: {
        subject: 'Balance Update - SwiftPayme',
        body: `Your account balance has been updated. New balance: ${data.currency} ${data.balance}`
      },
      kyc_status_updated: {
        subject: 'KYC Status Update - SwiftPayme',
        body: `Your KYC verification status has been updated to: ${data.status}`
      },
      profile_updated: {
        subject: 'Profile Updated - SwiftPayme',
        body: 'Your profile information has been successfully updated.'
      },
      security_alert: {
        subject: 'Security Alert - SwiftPayme',
        body: `Security alert: ${data.alertType}. If this wasn't you, please contact support immediately.`
      }
    };

    return templates[template as keyof typeof templates] || {
      subject: 'SwiftPayme Notification',
      body: 'You have a new notification from SwiftPayme.'
    };
  }

  private getSMSTemplate(template: string, data: any): string {
    const templates = {
      security_alert_sms: `SwiftPayme Security Alert: ${data.alertType}. If this wasn't you, contact support immediately.`,
      balance_updated: `SwiftPayme: Your balance has been updated to ${data.currency} ${data.balance}`,
      kyc_status_updated: `SwiftPayme: Your KYC status is now ${data.status}`
    };

    return templates[template as keyof typeof templates] || 'SwiftPayme notification';
  }

  private getPushTemplate(template: string, data: any): { title: string; body: string } {
    const templates = {
      balance_updated: {
        title: 'Balance Updated',
        body: `Your balance is now ${data.currency} ${data.balance}`
      },
      account_created: {
        title: 'Account Created',
        body: 'Your SwiftPayme account has been successfully created'
      },
      kyc_status_updated: {
        title: 'KYC Status Update',
        body: `Your verification status: ${data.status}`
      }
    };

    return templates[template as keyof typeof templates] || {
      title: 'SwiftPayme',
      body: 'You have a new notification'
    };
  }
}

