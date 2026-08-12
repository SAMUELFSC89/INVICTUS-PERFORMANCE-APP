import { db } from '../_lib/common.js';

export interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, any>;
}

export class NotificationService {
  async send(notification: NotificationPayload): Promise<void> {
    console.log(`[NOTIFICATION] [${notification.userId}] Sending notification: ${notification.title}`);
    await db.collection('notifications').add({
      ...notification,
      read: false,
      createdAt: new Date().toISOString()
    });
  }
}
