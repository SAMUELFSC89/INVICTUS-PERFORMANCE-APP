import { db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot,
  updateDoc,
  getDocs
} from 'firebase/firestore';
import { SocialNotification, UserProfile } from '../types';

const NOTIF_CACHE_KEY = 'cached_notifications_';
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

export const notificationService = {
  // ... existing createNotification ...
  async createNotification(recipientId: string, senderId: string, type: SocialNotification['type'], postId?: string, message?: string, senderInfo?: { name: string, photoURL?: string }) {
    try {
      let senderName = senderInfo?.name || 'Sistema';
      let senderPhotoURL = senderInfo?.photoURL || '';

      if (!senderInfo && senderId !== recipientId) {
        const senderSnap = await getDoc(doc(db, 'users', senderId));
        if (senderSnap.exists()) {
          const senderData = senderSnap.data() as UserProfile;
          senderName = senderData.displayName;
          senderPhotoURL = senderData.photoURL || '';
        }
      }
      
      const notification: SocialNotification = {
        id: doc(collection(db, 'notifications')).id,
        recipientId,
        senderId,
        senderName,
        senderPhotoURL,
        type,
        postId: postId || null,
        message: message || null,
        read: false,
        createdAt: new Date().toISOString()
      };
      
      await setDoc(doc(db, 'notifications', notification.id), notification);
    } catch (error) {
      console.error('Error creating notification:', error);
    }
  },

  async getNotifications(userId: string): Promise<SocialNotification[]> {
    // Try to load from cache first
    const cacheKey = `${NOTIF_CACHE_KEY}${userId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          return data;
        }
      } catch (e) {
        localStorage.removeItem(cacheKey);
      }
    }

    try {
      const q = query(
        collection(db, 'notifications'),
        where('recipientId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      
      const snap = await getDocs(q);
      const data = snap.docs.map(doc => doc.data() as SocialNotification);
      
      // Update cache
      localStorage.setItem(cacheKey, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
      
      return data;
    } catch (error: any) {
      console.error('Error fetching notifications:', error);
      if (error?.message?.includes('quota')) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            return JSON.parse(cached).data;
          } catch (e) {}
        }
      }
      return [];
    }
  },

  listenToNotifications(userId: string, callback: (notifications: SocialNotification[]) => void) {
    // We'll keep a limited snapshot for REAL-TIME updates but only for the last 5
    // to minimize reads, or just fallback to polling if requested.
    // For now, let's just do a highly-limited listener.
    const qShort = query(
      collection(db, 'notifications'),
      where('recipientId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(5)
    );
    
    return onSnapshot(qShort, (snap) => {
      // When a new notification arrives, we refresh the full list from cache-friendly getter
      this.getNotifications(userId).then(callback);
    }, (error) => {
      console.error('Notification listener error:', error);
    });
  },

  async markNotificationAsRead(notificationId: string) {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), { read: true });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  }
};
