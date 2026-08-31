import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import { doc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { UserProfile } from '../types';
import { API_CONFIG } from '../config';

export const userService = {
  async updateProfilePhoto(photoBlob: Blob) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    // Strict preventive size validation to avoid large payloads / approaching document/Firestore limits
    const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit
    if (photoBlob.size > MAX_SIZE_BYTES) {
      throw new Error(`A foto selecionada é muito grande (${(photoBlob.size / 1024 / 1024).toFixed(2)}MB). Por favor, selecione uma imagem de até 5MB.`);
    }

    console.log('Updating profile photo for user:', user.uid, 'Size:', photoBlob.size);
    const userRef = doc(db, 'users', user.uid);
    let photoURL = '';

    try {
      const storageRef = ref(storage, `profiles/${user.uid}/avatar.jpg`);
      const uploadTask = uploadBytesResumable(storageRef, photoBlob, {
        contentType: 'image/jpeg'
      });

      photoURL = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          uploadTask.cancel();
          reject(new Error('TIMEOUT'));
        }, 20000); // 20s timeout for profile photo

        uploadTask.on('state_changed', null, (err) => {
          clearTimeout(timeout);
          reject(err);
        }, async () => {
          clearTimeout(timeout);
          try {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          } catch (urlErr) {
            reject(urlErr);
          }
        });
      });
      
      await updateDoc(userRef, { photoURL });
      return photoURL;
    } catch (error: any) {
      console.error('Error updating profile photo:', error);
      if (error.message === 'TIMEOUT') {
        throw new Error('Tempo limite excedido ao enviar a foto. Verifique sua conexão com a internet.');
      }
      if (error.code === 'storage/unauthorized') {
        throw new Error('Erro de permissão no Storage ao atualizar foto de perfil.');
      }
      throw new Error('Não foi possível fazer o upload da sua foto de perfil. Por favor, tente novamente.');
    }
  },

  async removeProfilePhoto() {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    console.log('Removing profile photo for user:', user.uid);
    const userRef = doc(db, 'users', user.uid);
    try {
      await updateDoc(userRef, { photoURL: '' });
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
