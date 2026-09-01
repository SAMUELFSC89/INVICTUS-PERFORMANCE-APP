import { db, auth, storage, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  updateDoc,
  arrayUnion} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Story } from '../types';

export const storyService = {
  async createStory(userId: string, imageBlob: Blob, userDisplayName: string, userPhotoURL?: string) {
    const currentUid = auth.currentUser?.uid;
    console.log('Starting createStory. Argument userId:', userId, 'Auth currentUser.uid:', currentUid);
    
    try {
      const storyId = doc(collection(db, 'stories')).id;
      const uploadUid = currentUid || userId;
      let imageUrl = '';
      
      console.log(`Uploading story image to: stories/${uploadUid}/${storyId}.jpg | Size: ${imageBlob.size} bytes`);
      const storageRef = ref(storage, `stories/${uploadUid}/${storyId}.jpg`);
      
      try {
        // Try uploading to Storage with a 30s timeout for stories
        const uploadTask = uploadBytesResumable(storageRef, imageBlob, {
          contentType: 'image/jpeg'
        });

        imageUrl = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            uploadTask.cancel();
            reject(new Error('TIMEOUT'));
          }, 15000); // Reduced to 15s for stories

          uploadTask.on('state_changed', null, reject, async () => {
            clearTimeout(timeout);
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          });
        });
      } catch (uploadError: any) {
        console.warn('Story upload failed, using base64 fallback:', uploadError);
        // Fallback to base64 in Firestore if Storage fails
        imageUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(imageBlob);
        });
      }

      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000); // 24 hours later

      const story: Story = {
        id: storyId,
        userId: uploadUid,
        userDisplayName,
        userPhotoURL: userPhotoURL || null,
        imageUrl,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        viewedBy: []
      };

      console.log('Saving story to Firestore:', storyId);
      await setDoc(doc(db, 'stories', storyId), story);
      console.log('Story created successfully!');
      return story;
    } catch (error) {
      console.error('Error in createStory:', error);
      handleFirestoreError(error, OperationType.WRITE, 'stories');
    }
  },

  async getActiveStories(followingIds: string[] = []) {
    try {
      const now = new Date().toISOString();
      let q;
      
      if (followingIds.length > 0) {
        // Include self
        const ids = [...followingIds, auth.currentUser?.uid].filter(Boolean) as string[];
        const limitedIds = ids.slice(0, 30);
        
        q = query(
          collection(db, 'stories'),
          where('userId', 'in', limitedIds),
          where('expiresAt', '>', now),
          orderBy('expiresAt', 'asc')
        );
      } else {
        // Just self if not following anyone
        q = query(
          collection(db, 'stories'),
          where('userId', '==', auth.currentUser?.uid),
          where('expiresAt', '>', now),
          orderBy('expiresAt', 'asc')
        );
      }

      const snap = await getDocs(q);
      return snap.docs.map(doc => doc.data() as Story);
    } catch (error) {
      console.error('Error fetching stories:', error);
      return [];
    }
  },

  listenToStories(followingIds: string[], callback: (stories: Story[]) => void) {
    const now = new Date().toISOString();
    const ids = [...followingIds, auth.currentUser?.uid].filter(Boolean) as string[];
    const limitedIds = ids.slice(0, 30);

    const q = query(
      collection(db, 'stories'),
      where('userId', 'in', limitedIds),
      where('expiresAt', '>', now),
      orderBy('expiresAt', 'asc')
    );

    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(doc => doc.data() as Story));
    }, (error) => {
      console.error('Stories listener error:', error);
    });
  },

  async markAsViewed(storyId: string, userId: string) {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        viewedBy: arrayUnion(userId)
      });
    } catch (error) {
      console.error('Error marking story as viewed:', error);
    }
  }
};
