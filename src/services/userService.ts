import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import { deleteField, doc, getDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, ref, uploadBytesResumable, getDownloadURL, type StorageReference } from 'firebase/storage';
import { UserProfile } from '../types';
import { API_CONFIG } from '../config';

function storedAvatarValue(data: Record<string, any> | undefined): unknown {
  if (!data) return null;
  return data.photoURL || data.photoUrl || data.photo_url || null;
}

function ownedAvatarReference(photoURL: unknown, userId: string): StorageReference | null {
  if (typeof photoURL !== 'string' || !photoURL) return null;
  try {
    const candidate = ref(storage, photoURL);
    return candidate.fullPath.startsWith(`profiles/${userId}/`) ? candidate : null;
  } catch {
    // Provider avatars and malformed legacy values never belong to our bucket.
    return null;
  }
}

async function deleteOwnedAvatar(photoURL: unknown, userId: string) {
  const avatarRef = ownedAvatarReference(photoURL, userId);
  if (!avatarRef) return;
  try {
    await deleteObject(avatarRef);
  } catch (error: any) {
    if (error?.code !== 'storage/object-not-found') throw error;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(code)), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export const userService = {
  async updateProfilePhoto(photoBlob: Blob) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    if (!photoBlob.type.startsWith('image/')) {
      throw new Error('O arquivo selecionado não é uma imagem válida.');
    }

    // The UI compresses the image before this boundary; keep a defensive cap here.
    const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit
    if (photoBlob.size > MAX_SIZE_BYTES) {
      throw new Error(`A foto selecionada é muito grande (${(photoBlob.size / 1024 / 1024).toFixed(2)}MB). Por favor, selecione uma imagem de até 5MB.`);
    }

    console.log('Updating profile photo for user:', user.uid, 'Size:', photoBlob.size);
    const userRef = doc(db, 'users', user.uid);
    let photoURL = '';
    let previousPhotoURL: unknown = null;

    try {
      // A foto anterior é necessária apenas para limpeza. Nunca deixe essa
      // leitura bloquear o upload no WKWebView/iOS.
      try {
        const previousSnap = await withTimeout(getDoc(userRef), 8_000, 'PREVIOUS_PHOTO_READ_TIMEOUT');
        previousPhotoURL = storedAvatarValue(previousSnap.data() as Record<string, any> | undefined);
      } catch (previousReadError) {
        console.warn('Previous profile photo could not be read before upload:', previousReadError);
      }

      // A versioned path prevents WKWebView/browser caches from displaying an
      // overwritten avatar through the previous download URL.
      const storageRef = ref(storage, `profiles/${user.uid}/avatar-${Date.now()}.jpg`);
      const uploadTask = uploadBytesResumable(storageRef, photoBlob, {
        contentType: photoBlob.type || 'image/jpeg',
        cacheControl: 'public,max-age=31536000,immutable'
      });

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve();
        };
        const timeout = setTimeout(() => {
          uploadTask.cancel();
          finish(new Error('UPLOAD_TIMEOUT'));
        }, 60_000);

        uploadTask.on(
          'state_changed',
          undefined,
          error => finish(error),
          () => finish()
        );
      });

      photoURL = await withTimeout(getDownloadURL(uploadTask.snapshot.ref), 15_000, 'DOWNLOAD_URL_TIMEOUT');

      // photoURL é o campo canônico. Removemos aliases antigos para não deixar
      // uma URL obsoleta reaparecer em telas que ainda façam fallback legado.
      await withTimeout(updateDoc(userRef, {
        photoURL,
        photoUrl: deleteField(),
        photo_url: deleteField(),
      }), 15_000, 'PROFILE_WRITE_TIMEOUT');

      deleteOwnedAvatar(previousPhotoURL, user.uid).catch((cleanupError) => {
        console.warn('Previous profile photo cleanup failed:', cleanupError);
      });
      return photoURL;
    } catch (error: any) {
      console.error('Error updating profile photo:', error);
      if (['UPLOAD_TIMEOUT', 'DOWNLOAD_URL_TIMEOUT', 'PROFILE_WRITE_TIMEOUT'].includes(String(error?.message || ''))) {
        throw new Error('O envio da foto não concluiu a tempo. Tente novamente; se estiver no iPhone, mantenha o app aberto durante o envio.');
      }
      if (error.code === 'storage/unauthorized') {
        throw new Error('Erro de permissão no Storage ao atualizar foto de perfil.');
      }
      if (error.code === 'storage/canceled') {
        throw new Error('O envio da foto foi interrompido. Tente novamente.');
      }
      if (error.code === 'storage/retry-limit-exceeded') {
        throw new Error('A conexão oscilou durante o envio. Tente novamente em uma rede estável.');
      }
      const reference = error?.code ? ` Referência: ${String(error.code)}.` : '';
      throw new Error(`Não foi possível enviar a foto.${reference} Tente novamente.`);
    }
  },

  async removeProfilePhoto() {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    console.log('Removing profile photo for user:', user.uid);
    const userRef = doc(db, 'users', user.uid);
    try {
      const previousData = (await getDoc(userRef)).data() as Record<string, any> | undefined;
      const previousPhotoURL = storedAvatarValue(previousData);
      await deleteOwnedAvatar(previousPhotoURL, user.uid);
      await updateDoc(userRef, {
        photoURL: '',
        photoUrl: deleteField(),
        photo_url: deleteField(),
      });
      return true;
    } catch (error: any) {
      console.error('Error removing profile photo:', error);
      throw new Error('Não foi possível remover a foto de perfil. Tente novamente.');
    }
  },

  async updateProfile(data: Partial<UserProfile>) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const userRef = doc(db, 'users', user.uid);
    const updateData: any = { ...data };

    // Remove fields that shouldn't be updated directly via this method if any
    delete updateData.uid;
    delete updateData.email;
    delete updateData.score;
    delete updateData.streak;
    delete updateData.referralCode;

    try {
      await updateDoc(userRef, updateData);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      throw error;
    }
  },

  async toggleNotifications(enabled: boolean) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const userRef = doc(db, 'users', user.uid);
    try {
      await updateDoc(userRef, {
        whatsappEnabled: enabled
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      throw error;
    }
  },

  async adminReclassifyUser(userId: string, league: UserProfile['league']) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const userRef = doc(db, 'users', userId);
    try {
      await updateDoc(userRef, {
        league: league,
        categoryVerifiedByAdmin: true
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
      throw error;
    }
  },

  async unlockAchievement(achievementId: string) {
    // Conquistas alteram ranking e precisam ser concedidas pela rotina
    // autenticada do servidor, após a atividade ter sido homologada. Este
    // método existe apenas para não quebrar integrações legadas do cliente;
    // ele nunca grava uma conquista por conta própria.
    console.warn(`[UserService] A conquista ${achievementId} só pode ser concedida pelo servidor.`);
    return false;
  },

  async likeProfile(targetUserId: string): Promise<{ count: number; alreadyRecognized: boolean }> {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');
    if (user.uid === targetUserId) return; // Cannot like your own profile
    const token = await user.getIdToken();
    const response = await fetch(`${API_CONFIG.baseUrl}/api/profile?action=recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetUserId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível reconhecer este atleta.');
    return { count: Number(payload.count) || 0, alreadyRecognized: payload.alreadyRecognized === true };
  }
};
