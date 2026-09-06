import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { auth, db, onAuthStateChanged } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { UserProfile } from './types';
import { configureRevenueCat, disconnectRevenueCat } from './lib/revenuecat';



interface UserContextType {
  user: UserProfile | null;
  loading: boolean;
  refreshUser: () => Promise<UserProfile | null>;
}

const UserContext = createContext<UserContextType>({ 
  user: null, 
  loading: true, 
  refreshUser: async () => null
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  // O cache nunca pode ser usado como identidade/autorização. No primeiro
  // frame ainda não sabemos qual conta o Firebase restaurará; renderizar o
  // perfil anterior aqui poderia expor dados e gates PRO de outro usuário.
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // AP-02 (auditoria 6167c8f): cada transição de auth (login, logout, troca
  // de conta) incrementa esta geração. Qualquer leitura assíncrona de perfil
  // iniciada por uma geração anterior nunca mais grava em setUser/localStorage
  // -- sem isso, um getDoc() lento de uma conta já deslogada podia "vencer" a
  // corrida contra o logout/troca e reaparecer com dados de outro usuário.
  const generationRef = useRef(0);

  // AP-01 / SEC-01 (auditoria 6167c8f): única forma segura de criar o
  // documento users/{uid} quando ele ainda não existe. As Firestore Rules
  // agora rejeitam um create() do cliente que traga campos privilegiados
  // (score, plano, isBlocked etc.), então o servidor (Admin SDK) decide esses
  // campos; o cliente só recebe de volta o perfil já criado.
  const ensureProfileViaServer = useCallback(async (uid: string): Promise<UserProfile | null> => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Sessão indisponível para preparar o perfil.');
    const response = await fetch('/api/profile?action=onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({})
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Não foi possível preparar seu perfil.');
    }
    const freshSnap = await getDoc(doc(db, 'users', uid));
    return freshSnap.exists() ? ({ uid: freshSnap.id, ...freshSnap.data() } as UserProfile) : null;
  }, []);

  const loadUserProfile = useCallback(async (uid: string, generation: number) => {
    const userRef = doc(db, 'users', uid);
    const isStale = () => generation !== generationRef.current || auth.currentUser?.uid !== uid;
    try {
      let snap = await getDoc(userRef);
      if (isStale()) {
        console.log(`[AUTH] [LOAD_PROFILE] [${uid}] [SKIP] Resolução obsoleta ignorada (sessão trocou)`);
        return null;
      }

      if (!snap.exists() && sessionStorage.getItem('is_registering_user') === 'true') {
        // AP-03 (auditoria 6167c8f): dá uma janela curta para o cadastro em
        // andamento (AuthGuard.handleRegister) concluir sozinho o onboarding
        // completo (CPF, plano, termos). Só criamos um perfil mínimo aqui se,
        // depois dessa janela, o documento continuar ausente -- sinal de que
        // a página recarregou no meio do cadastro e não existe mais nenhum
        // processo para completá-lo. Isso garante que "CARREGANDO SEU
        // PERFIL" nunca gira para sempre.
        console.log(`[AUTH] [LOAD_PROFILE] [${uid}] [INFO] Cadastro em andamento, aguardando conclusão antes de decidir`);
        await new Promise(resolve => setTimeout(resolve, 2500));
        if (isStale()) return null;
        snap = await getDoc(userRef);
        if (snap.exists()) {
          sessionStorage.removeItem('is_registering_user');
        }
      }

      if (snap.exists()) {
        const userData = { uid: snap.id, ...snap.data() } as UserProfile;
        setUser(userData);
        setLoading(false);
        console.log(`[AUTH] [LOAD_PROFILE] [${uid}] [SUCCESS] Perfil do usuário carregado com sucesso`);
        return userData;
      }

      // Primeiro acesso (login social) ou cadastro por e-mail interrompido
      // por um reload -- em ambos os casos a única forma segura de criar o
      // documento é pelo endpoint autenticado.
      console.log(`[AUTH] [ENSURE_PROFILE] [${uid}] [INFO] Perfil ausente no Firestore, solicitando criação mínima ao servidor`);
      sessionStorage.removeItem('is_registering_user');
      const userData = await ensureProfileViaServer(uid);
      if (isStale()) return null;
      if (userData) {
        setUser(userData);
        console.log(`[AUTH] [ENSURE_PROFILE] [${uid}] [SUCCESS] Perfil mínimo criado no servidor`);
      }
      setLoading(false);
      return userData;
    } catch (error: any) {
      console.error(`[AUTH] [LOAD_PROFILE] [${uid}] [FAILURE] Erro ao carregar perfil: ${error.message}`);
      if (!isStale()) setLoading(false);
      return null;
    }
  }, [ensureProfileViaServer]);

  const refreshUser = useCallback(async () => {
    if (auth.currentUser) {
      const generation = generationRef.current;
      console.log(`[AUTH] [REFRESH_USER] [${auth.currentUser.uid}] [INFO] Recarregando perfil do usuário`);
      return await loadUserProfile(auth.currentUser.uid, generation);
    }
    return null;
  }, [loadUserProfile]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      // AP-02: toda transição de auth invalida leituras em voo de transições
      // anteriores (ver comentário de generationRef acima).
      generationRef.current += 1;
      const generation = generationRef.current;
      // Fecha imediatamente a janela entre contas. Só o perfil lido para a
      // geração/UID atual poderá voltar a ser publicado pelo contexto.
      setLoading(true);
      setUser(null);
      localStorage.removeItem('last_user_profile');
      if (firebaseUser) {
        console.log(`[AUTH] [SESSION_CHANGE] [${firebaseUser.uid}] [INFO] Estado de autenticação alterado: Logado`);
        // BILL-02: antecipamos a vinculação do SDK, mas não bloqueamos a carga
        // do perfil se a loja estiver lenta. A ação de compra chama e aguarda a
        // mesma fila antes de buscar ofertas, portanto nunca compra sem UID.
        void configureRevenueCat(firebaseUser.uid).catch((error: any) => {
          console.error(`[AUTH] [REVENUECAT] [${firebaseUser.uid}] [FAILURE] ${error?.message || 'Falha ao vincular usuário'}`);
        });
        await loadUserProfile(firebaseUser.uid, generation);
      } else {
        console.log(`[AUTH] [SESSION_CHANGE] [GUEST] [INFO] Estado de autenticação alterado: Deslogado`);
        setUser(null);
        localStorage.removeItem('last_user_profile');
        setLoading(false);
        try {
          await disconnectRevenueCat();
        } catch (error: any) {
          console.error(`[AUTH] [REVENUECAT] [GUEST] [FAILURE] ${error?.message || 'Falha ao desvincular usuário'}`);
        }
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
