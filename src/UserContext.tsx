import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { auth, db, onAuthStateChanged } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { UserProfile } from './types';
import { referralService } from './services/referralService';
import { rankingService } from './services/rankingService';

const normalizeString = (str: string) => 
  str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const generateSearchKeywords = (name: string, username?: string): string[] => {
  const keywords = new Set<string>();
  const normalizedName = normalizeString(name);
  const parts = normalizedName.split(/\s+/);
  parts.forEach(part => {
    for (let i = 1; i <= part.length; i++) keywords.add(part.substring(0, i));
  });
  for (let i = 1; i <= normalizedName.length; i++) keywords.add(normalizedName.substring(0, i));
  if (username) {
    const normalizedUsername = username.toLowerCase();
    for (let i = 1; i <= normalizedUsername.length; i++) keywords.add(normalizedUsername.substring(0, i));
  }
  return Array.from(keywords).slice(0, 100);
};

interface UserContextType {
  user: UserProfile | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({ 
  user: null, 
  loading: true, 
  refreshUser: async () => {} 
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(() => {
    const cached = localStorage.getItem('last_user_profile');
    try {
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const loadUserProfile = useCallback(async (uid: string) => {
    const userRef = doc(db, 'users', uid);
    try {
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const userData = { uid: snap.id, ...snap.data() } as UserProfile;
        
        setUser(userData);
        localStorage.setItem('last_user_profile', JSON.stringify(userData));
        setLoading(false);
        console.log(`[AUTH] [LOAD_PROFILE] [${uid}] [SUCCESS] Perfil do usuário carregado com sucesso`);
        return userData;
      } else {
        // Social Login Onboarding: Create profile if missing
        if (sessionStorage.getItem('is_registering_user') === 'true') {
          console.log(`[AUTH] [LOAD_PROFILE] [${uid}] [INFO] Usuário em fluxo de registro, aguardando criação do perfil completo`);
          return null;
        }
        console.log(`[AUTH] [CREATE_DEFAULT_PROFILE] [${uid}] [INFO] Perfil ausente no Firestore, criando perfil padrão`);
        const now = new Date();
        
        const newUser: any = {
          uid: uid,
          displayName: auth.currentUser?.displayName || 'Atleta',
          email: auth.currentUser?.email || '',
          plano: 'Nenhum',
          currentPlan: 'Nenhum',
          assinatura: 'Inativa',
          subscriptionStatus: 'inactive',
          status: 'Aguardando pagamento',
          paymentStatus: 'Aguardando pagamento',
          statusPagamento: 'Aguardando pagamento',
          premium: false,
          performance: false,
          isSubscribed: false,
          subscriptionTier: 'Nenhum',
          role: 'user',
          termsAccepted: false,
          createdAt: now.toISOString()
        };
        
        await setDoc(userRef, newUser);
        setUser(newUser);
        localStorage.setItem('last_user_profile', JSON.stringify(newUser));
        setLoading(false);
        console.log(`[AUTH] [CREATE_DEFAULT_PROFILE] [${uid}] [SUCCESS] Perfil padrão criado no Firestore`);
        return newUser;
      }
    } catch (error: any) {
      console.error(`[AUTH] [LOAD_PROFILE] [${uid}] [FAILURE] Erro ao carregar perfil: ${error.message}`);
      if (error?.code === 'resource-exhausted' || error?.message?.includes('quota')) {
        setQuotaExceeded(true);
      }
      setLoading(false);
      return null;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    if (auth.currentUser) {
      console.log(`[AUTH] [REFRESH_USER] [${auth.currentUser.uid}] [INFO] Recarregando perfil do usuário`);
      await loadUserProfile(auth.currentUser.uid);
    }
  }, [loadUserProfile]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        console.log(`[AUTH] [SESSION_CHANGE] [${firebaseUser.uid}] [INFO] Estado de autenticação alterado: Logado`);
        await loadUserProfile(firebaseUser.uid);
      } else {
        console.log(`[AUTH] [SESSION_CHANGE] [GUEST] [INFO] Estado de autenticação alterado: Deslogado`);
        setUser(null);
        localStorage.removeItem('last_user_profile');
        setLoading(false);
      }
    });

    return () => unsubAuth();
  }, [loadUserProfile]);

  // Removed UI-blocking quota screen per user request
  return (
    <UserContext.Provider value={{ user, loading, refreshUser }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);
