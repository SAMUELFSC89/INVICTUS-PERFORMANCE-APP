import { 
  db, 
  storage, 
  auth, 
  handleFirestoreError, 
  OperationType 
} from '../firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit, 
  increment, 
  arrayUnion, 
  arrayRemove, 
  startAfter,
  runTransaction
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Post, Follow, UserProfile } from '../types';
import { notificationService } from './notificationService';

export const socialService = {
  // --- POSTS ---
  async createPost(userId: string, userDisplayName: string, userPhotoURL: string | undefined, imageBlob: Blob | null, caption: string, points?: number, streak?: number, onProgress?: (progress: number) => void) {
    const currentUid = auth.currentUser?.uid;
    console.log('Starting createPost. Argument userId:', userId, 'Auth currentUser.uid:', currentUid);
    
    if (userId !== currentUid) {
      console.warn('userId mismatch! Using auth.currentUser.uid instead for storage path.');
    }

    try {
      const postId = doc(collection(db, 'posts')).id;
      let imageUrl = '';

      if (imageBlob) {
        if (imageBlob.size === 0) {
          throw new Error('O arquivo de imagem está vazio.');
        }
        
        try {
          const uploadUid = currentUid || userId;
          console.log(`Uploading image to: posts/${uploadUid}/${postId}.jpg | Size: ${imageBlob.size} bytes`);
          
          const storageRef = ref(storage, `posts/${uploadUid}/${postId}.jpg`);
          
          const uploadTask = uploadBytesResumable(storageRef, imageBlob, {
            contentType: 'image/jpeg',
            customMetadata: {
              'uploadedBy': uploadUid,
              'postId': postId
            }
          });

          try {
            imageUrl = await new Promise<string>((resolve, reject) => {
              const timeout = setTimeout(() => {
                console.warn('Upload Task TIMEOUT triggered after 20s. Attempting base64 fallback.');
                uploadTask.cancel();
                reject(new Error('TIMEOUT'));
              }, 20000); // Reduced to 20 seconds for faster fallback
  
              uploadTask.on('state_changed', 
                (snapshot) => {
                  const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                  console.log(`Upload process: ${Math.round(progress)}% (${snapshot.bytesTransferred}/${snapshot.totalBytes} bytes)`);
                  if (onProgress) onProgress(progress);
                }, 
                (error) => {
                  clearTimeout(timeout);
                  if (error.code === 'storage/canceled') {
                    console.warn('Upload Task CANCELED (likely due to timeout)');
                  } else {
                    console.error('Upload Task ERROR:', error);
                  }
                  reject(error);
                }, 
                async () => {
                  clearTimeout(timeout);
                  console.log('Upload Task SUCCESSFUL. Finalizing metadata...');
                  try {
                    const url = await getDownloadURL(uploadTask.snapshot.ref);
                    resolve(url);
                  } catch (urlError) {
                    console.error('Error getting download URL:', urlError);
                    reject(urlError);
                  }
                }
              );
            });
          } catch (uploadError: any) {
            // Check if it's a timeout or a connectivity error to use fallback
            if (
              uploadError.message === 'TIMEOUT' || 
              uploadError.code === 'storage/canceled' ||
              uploadError.code?.includes('not-found') || 
              uploadError.code?.includes('retry-limit-exceeded')
            ) {
              console.log('Using Base64 fallback due to storage upload failure/timeout');
              if (imageBlob.size > 800000) { // ~800KB safety limit for base64 in Firestore
                throw new Error('A imagem é muito grande para o backup automático. Tente uma foto menor.');
              }
              imageUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(imageBlob);
              });
              console.log('Base64 fallback generated successfully.');
            } else {
              throw uploadError;
            }
          }
          
          console.log('Image URL/Data obtained.');
        } catch (uploadError: any) {
          console.error('Error during image upload/fallback:', uploadError);
          if (uploadError.code === 'storage/unauthorized') {
            throw new Error('Erro de permissão no Firebase Storage.');
          }
          throw new Error(`Erro ao enviar imagem: ${uploadError.message || 'Erro desconhecido'}`);
        }
      }
      
      const post: any = {
        id: postId,
        userId: currentUid || userId,
        userDisplayName: userDisplayName || 'Atleta',
        imageUrl: imageUrl || '',
        caption: caption || '',
        likesCount: 0,
        likedBy: [],
        commentsCount: 0,
        sharesCount: 0,
        createdAt: new Date().toISOString(),
      };

      if (userPhotoURL) post.userPhotoURL = userPhotoURL;
      if (points !== undefined) post.points = points;
      if (streak !== undefined) post.streak = streak;
      
      console.log('Saving post to Firestore:', postId);
      
      // Using direct setDoc and updateDoc instead of transaction for better resilience in poor connections
      const postRef = doc(db, 'posts', postId);
      const userRef = doc(db, 'users', currentUid || userId);

      await setDoc(postRef, post);
      console.log('Post document saved.');

      try {
        await updateDoc(userRef, {
          postsCount: increment(1)
        });
        console.log('User stats updated.');
      } catch (userUpdateError) {
        console.warn('Post created but user stats update failed:', userUpdateError);
        // We don't throw here because the post was already created successfully
      }
      
      return post;
    } catch (error) {
      console.error('Final error in createPost:', error);
      handleFirestoreError(error, OperationType.WRITE, 'posts');
    }
  },

  async getPosts(followingIds: string[] = [], type: 'following' | 'explore' = 'explore', lastDoc?: any) {
    try {
      let q;
      const baseLimit = 10;
      
      if (type === 'following' && followingIds.length > 0) {
        const limitedFollowing = followingIds.slice(0, 30); // Firestore 'in' limit is 30
        q = query(
          collection(db, 'posts'),
          where('userId', 'in', limitedFollowing),
          orderBy('createdAt', 'desc'),
          limit(baseLimit)
        );
      } else {
        q = query(
          collection(db, 'posts'),
          orderBy('createdAt', 'desc'),
          limit(baseLimit)
        );
      }

      if (lastDoc) {
        q = query(q, startAfter(lastDoc));
      }
      
      const snap = await getDocs(q);
      const allPosts = snap.docs.map(doc => doc.data() as Post);
      
      const filteredPosts = allPosts.filter(post => {
        if (!post.createdAt) return false;
        const postTime = new Date(post.createdAt).getTime();
        const now = new Date().getTime();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        const isOld = (now - postTime) > threeDaysMs;

        const nameLower = (post.userDisplayName || '').toLowerCase();
        const captionLower = (post.caption || '').toLowerCase();
        
        const isBot = nameLower.includes('bot') || 
                      nameLower.includes('sistema') || 
                      nameLower.includes('test') || 
                      nameLower.includes('thiago melazzo') || 
                      nameLower.includes('mariana silveira') ||
                      post.userId?.toLowerCase().includes('bot') ||
                      captionLower.includes('falso') || 
                      captionLower.includes('fakes') ||
                      captionLower.includes('cheat');

        return !isOld && !isBot;
      });

      return {
        posts: filteredPosts,
        lastDoc: snap.docs[snap.docs.length - 1]
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'posts');
      return { posts: [], lastDoc: null };
    }
  },

  async toggleLike(postId: string, userId: string, postOwnerId: string, isLiked: boolean, senderInfo?: { name: string, photoURL?: string }) {
    try {
      const postRef = doc(db, 'posts', postId);
      
      await runTransaction(db, async (transaction) => {
        const postSnap = await transaction.get(postRef);
        if (!postSnap.exists()) return;
        
        const postData = postSnap.data() as Post;
        const currentlyLiked = postData.likedBy.includes(userId);
        
        if (isLiked && currentlyLiked) {
          transaction.update(postRef, {
            likesCount: increment(-1),
            likedBy: arrayRemove(userId)
          });
        } else if (!isLiked && !currentlyLiked) {
          transaction.update(postRef, {
            likesCount: increment(1),
            likedBy: arrayUnion(userId)
          });
        }
      });

      if (!isLiked) {
        // Create notification if not self
        if (userId !== postOwnerId) {
          await notificationService.createNotification(postOwnerId, userId, 'like', postId, undefined, senderInfo);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `posts/${postId}`);
    }
  },

  // --- COMMENTS ---
  async addComment(postId: string, userId: string, userDisplayName: string, userPhotoURL: string | undefined, text: string) {
    try {
      const commentId = doc(collection(db, 'posts', postId, 'comments')).id;
      const comment = {
        id: commentId,
        userId,
        userDisplayName,
        userPhotoURL: userPhotoURL || '',
        text,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'posts', postId, 'comments', commentId), comment);
      await updateDoc(doc(db, 'posts', postId), {
        commentsCount: increment(1)
      });

      // Notify post owner
      const postSnap = await getDoc(doc(db, 'posts', postId));
      if (postSnap.exists()) {
        const postData = postSnap.data() as Post;
        if (postData.userId !== userId) {
          await notificationService.createNotification(
            postData.userId, 
            userId, 
            'comment', 
            postId, 
            text.substring(0, 50), 
            { name: userDisplayName, photoURL: userPhotoURL }
          );
        }
      }

      return comment;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `posts/${postId}/comments`);
    }
  },

  async getComments(postId: string) {
    try {
      const q = query(
        collection(db, 'posts', postId, 'comments'),
        orderBy('createdAt', 'asc'),
        limit(100)
      );
      const snap = await getDocs(q);
      return snap.docs.map(doc => doc.data());
    } catch (error) {
      console.error('Error getting comments:', error);
      return [];
    }
  },

  async sharePost(postId: string) {
    try {
      await updateDoc(doc(db, 'posts', postId), {
        sharesCount: increment(1)
      });
      return true;
    } catch (error) {
      console.error('Error sharing post:', error);
      return false;
    }
  },

  // --- FOLLOWS ---
  async toggleFollow(followerId: string, followingId: string, isFollowing: boolean, followerInfo?: { name: string, photoURL?: string }) {
    try {
      const followId = `${followerId}_${followingId}`;
      const followRef = doc(db, 'follows', followId);
      
      await runTransaction(db, async (transaction) => {
        if (isFollowing) {
          transaction.delete(followRef);
          transaction.update(doc(db, 'users', followerId), { followingCount: increment(-1) });
          transaction.update(doc(db, 'users', followingId), { followersCount: increment(-1) });
        } else {
          const follow: Follow = {
            id: followId,
            followerId,
            followingId,
            createdAt: new Date().toISOString()
          };
          transaction.set(followRef, follow);
          transaction.update(doc(db, 'users', followerId), { followingCount: increment(1) });
          transaction.update(doc(db, 'users', followingId), { followersCount: increment(1) });
        }
      });
      
      if (!isFollowing) {
        await notificationService.createNotification(followingId, followerId, 'follow', undefined, undefined, followerInfo);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'follows');
    }
  },

  async getFollowingIds(userId: string) {
    try {
      const q = query(
        collection(db, 'follows'), 
        where('followerId', '==', userId),
        limit(100) // Reasonable limit for feed
      );
      const snap = await getDocs(q);
      return snap.docs.map(doc => (doc.data() as Follow).followingId);
    } catch (error) {
      return [];
    }
  },

  async searchUsers(searchTerm: string) {
    try {
      if (!searchTerm.trim()) return [];
      
      const term = searchTerm.toLowerCase().trim();
      const normalizedTerm = term.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      // Use searchKeywords for prefix matching (much more reliable)
      const q = query(
        collection(db, 'users'),
        where('searchKeywords', 'array-contains', normalizedTerm),
        limit(15)
      );
      
      const snap = await getDocs(q);
      let results = snap.docs.map(doc => doc.data() as UserProfile);

      // Simple sorting: exact username matches first, then display name starts
      results.sort((a, b) => {
        if (a.username === term) return -1;
        if (b.username === term) return 1;
        
        const aStarts = a.displayNameLower?.startsWith(normalizedTerm);
        const bStarts = b.displayNameLower?.startsWith(normalizedTerm);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        
        return 0;
      });
      
      return results.slice(0, 10);
    } catch (error) {
      console.error('Error searching users:', error);
      return [];
    }
  }
};
