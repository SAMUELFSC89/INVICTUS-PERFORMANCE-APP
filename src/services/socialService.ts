import {
  db,
  storage,
  auth,
  handleFirestoreError,
  OperationType,
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
  runTransaction,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Post, Follow, UserProfile } from '../types';
import { notificationService } from './notificationService';

async function authenticatedSocialRequest<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  await auth.authStateReady();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Sessão inválida. Entre novamente para continuar.');
  const token = await currentUser.getIdToken();
  const response = await fetch(`/api/missions?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a ação social agora.');
  return payload as T;
}

function syncSocialStatsBestEffort(affectedUserId?: string) {
  void authenticatedSocialRequest('sync-social-stats', affectedUserId ? { affectedUserId } : {})
    .catch((error) => console.warn('[Social] Falha ao reconciliar contadores:', error));
}

export const socialService = {
  // --- POSTS ---
  async createPost(userId: string, userDisplayName: string, userPhotoURL: string | undefined, imageBlob: Blob | null, caption: string, points?: number, streak?: number, onProgress?: (progress: number) => void) {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) throw new Error('Sessão inválida. Entre novamente para publicar.');
    if (userId !== currentUid) {
      console.warn('[Social] userId divergente ignorado; usando UID autenticado.');
    }

    try {
      const postId = doc(collection(db, 'posts')).id;
      let imageUrl = '';

      if (imageBlob) {
        if (imageBlob.size === 0) throw new Error('O arquivo de imagem está vazio.');

        try {
          const storageRef = ref(storage, `posts/${currentUid}/${postId}.jpg`);
          const uploadTask = uploadBytesResumable(storageRef, imageBlob, {
            contentType: 'image/jpeg',
            customMetadata: { uploadedBy: currentUid, postId },
          });

          try {
            imageUrl = await new Promise<string>((resolve, reject) => {
              const timeout = setTimeout(() => {
                uploadTask.cancel();
                reject(new Error('TIMEOUT'));
              }, 20000);

              uploadTask.on('state_changed',
                (snapshot) => {
                  const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                  onProgress?.(progress);
                },
                (error) => {
                  clearTimeout(timeout);
                  reject(error);
                },
                async () => {
                  clearTimeout(timeout);
                  try {
                    resolve(await getDownloadURL(uploadTask.snapshot.ref));
                  } catch (urlError) {
                    reject(urlError);
                  }
                },
              );
            });
          } catch (uploadError: any) {
            if (
              uploadError?.message === 'TIMEOUT' ||
              uploadError?.code === 'storage/canceled' ||
              uploadError?.code?.includes('not-found') ||
              uploadError?.code?.includes('retry-limit-exceeded')
            ) {
              if (imageBlob.size > 800000) {
                throw new Error('A imagem é muito grande para o backup automático. Tente uma foto menor.');
              }
              imageUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(imageBlob);
              });
            } else {
              throw uploadError;
            }
          }
        } catch (uploadError: any) {
          if (uploadError?.code === 'storage/unauthorized') {
            throw new Error('Erro de permissão no Firebase Storage.');
          }
          throw new Error(`Erro ao enviar imagem: ${uploadError?.message || 'Erro desconhecido'}`);
        }
      }

      const post: any = {
        id: postId,
        userId: currentUid,
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

      await setDoc(doc(db, 'posts', postId), post);
      // postsCount/achievement/XP are server-derived from canonical posts.
      syncSocialStatsBestEffort();
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
        q = query(
          collection(db, 'posts'),
          where('userId', 'in', followingIds.slice(0, 30)),
          orderBy('createdAt', 'desc'),
          limit(baseLimit),
        );
      } else {
        q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(baseLimit));
      }
      if (lastDoc) q = query(q, startAfter(lastDoc));

      const snap = await getDocs(q);
      const allPosts = snap.docs.map(item => item.data() as Post);
      const filteredPosts = allPosts.filter(post => {
        if (!post.createdAt) return false;
        const postTime = new Date(post.createdAt).getTime();
        const isOld = (Date.now() - postTime) > 3 * 24 * 60 * 60 * 1000;
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
      return { posts: filteredPosts, lastDoc: snap.docs[snap.docs.length - 1] };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'posts');
      return { posts: [], lastDoc: null };
    }
  },

  async toggleLike(postId: string, userId: string, postOwnerId: string, isLiked: boolean, senderInfo?: { name: string, photoURL?: string }) {
    const actorId = auth.currentUser?.uid;
    if (!actorId) throw new Error('Sessão inválida.');
    if (userId !== actorId) console.warn('[Social] userId de like divergente ignorado.');

    try {
      const postRef = doc(db, 'posts', postId);
      await runTransaction(db, async (transaction) => {
        const postSnap = await transaction.get(postRef);
        if (!postSnap.exists()) return;
        const postData = postSnap.data() as Post;
        const likedBy = Array.isArray(postData.likedBy) ? postData.likedBy : [];
        const currentlyLiked = likedBy.includes(actorId);
        if (isLiked && currentlyLiked) {
          transaction.update(postRef, { likesCount: increment(-1), likedBy: arrayRemove(actorId) });
        } else if (!isLiked && !currentlyLiked) {
          transaction.update(postRef, { likesCount: increment(1), likedBy: arrayUnion(actorId) });
        }
      });

      if (!isLiked && actorId !== postOwnerId) {
        void notificationService.createNotification(postOwnerId, actorId, 'like', postId, undefined, senderInfo)
          .catch((error) => console.warn('[Social] Like salvo, mas notificação falhou:', error));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `posts/${postId}`);
    }
  },

  // --- COMMENTS ---
  async addComment(postId: string, userId: string, userDisplayName: string, userPhotoURL: string | undefined, text: string) {
    const actorId = auth.currentUser?.uid;
    if (!actorId) throw new Error('Sessão inválida.');
    if (userId !== actorId) console.warn('[Social] userId de comentário divergente ignorado.');

    try {
      const commentId = doc(collection(db, 'posts', postId, 'comments')).id;
      const comment = {
        id: commentId,
        userId: actorId,
        userDisplayName,
        userPhotoURL: userPhotoURL || '',
        text,
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'posts', postId, 'comments', commentId), comment);
      await updateDoc(doc(db, 'posts', postId), { commentsCount: increment(1) });

      const postSnap = await getDoc(doc(db, 'posts', postId));
      if (postSnap.exists()) {
        const postData = postSnap.data() as Post;
        if (postData.userId !== actorId) {
          void notificationService.createNotification(
            postData.userId,
            actorId,
            'comment',
            postId,
            text.substring(0, 50),
            { name: userDisplayName, photoURL: userPhotoURL },
          ).catch((error) => console.warn('[Social] Comentário salvo, mas notificação falhou:', error));
        }
      }
      return comment;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `posts/${postId}/comments`);
    }
  },

  async getComments(postId: string) {
    try {
      const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'), limit(100));
      const snap = await getDocs(q);
      return snap.docs.map(item => item.data());
    } catch (error) {
      console.error('Error getting comments:', error);
      return [];
    }
  },

  async sharePost(postId: string) {
    try {
      await authenticatedSocialRequest('record-post-share', { postId });
      return true;
    } catch (error) {
      console.error('Error sharing post:', error);
      return false;
    }
  },

  // --- FOLLOWS ---
  async toggleFollow(followerId: string, followingId: string, isFollowing: boolean, followerInfo?: { name: string, photoURL?: string }) {
    const actorId = auth.currentUser?.uid;
    if (!actorId) throw new Error('Sessão inválida.');
    if (followerId !== actorId) throw new Error('Não é possível alterar a relação de outra conta.');
    if (!followingId || followingId === actorId) throw new Error('Perfil inválido para seguir.');

    try {
      const followId = `${actorId}_${followingId}`;
      const followRef = doc(db, 'follows', followId);
      await runTransaction(db, async (transaction) => {
        if (isFollowing) {
          transaction.delete(followRef);
        } else {
          const follow: Follow = { id: followId, followerId: actorId, followingId, createdAt: new Date().toISOString() };
          transaction.set(followRef, follow);
        }
      });

      // Protected profile counters are recalculated by Admin SDK from follows.
      syncSocialStatsBestEffort(followingId);
      if (!isFollowing) {
        void notificationService.createNotification(followingId, actorId, 'follow', undefined, undefined, followerInfo)
          .catch((error) => console.warn('[Social] Follow salvo, mas notificação falhou:', error));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'follows');
    }
  },

  async getFollowingIds(userId: string) {
    try {
      const actorId = auth.currentUser?.uid;
      const scopedUserId = actorId === userId ? actorId : userId;
      if (!scopedUserId) return [];
      const q = query(collection(db, 'follows'), where('followerId', '==', scopedUserId), limit(100));
      const snap = await getDocs(q);
      return snap.docs.map(item => (item.data() as Follow).followingId);
    } catch {
      return [];
    }
  },

  async searchUsers(searchTerm: string) {
    try {
      const clean = searchTerm.trim();
      if (!clean) return [];
      const payload = await authenticatedSocialRequest<{ users?: UserProfile[] }>('search-users', { searchTerm: clean });
      return Array.isArray(payload.users) ? payload.users : [];
    } catch (error) {
      console.error('Error searching users:', error);
      return [];
    }
  },
};
