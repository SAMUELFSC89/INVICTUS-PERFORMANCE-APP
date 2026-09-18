import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { auth, db, onAuthStateChanged } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { UserProfile } from './types';
import { configureRevenueCat, disconnectRevenueCat } from './lib/revenuecat';
import { nativeBackgroundLocationService } from './services/nativeBackgroundLocationService';
import { webGpsTrackingService } from './services/webGpsTrackingService';
import { activityNotificationService } from './services/activityNotificationService';
import { activityLiveActivityService } from './services/activityLiveActivityService';
import { reconcilePushNotificationsForAuthChange } from './services/pushNotificationService';



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

const ACTIVE_SESSION_KEY = 'current_activity_session';

type ActivityStatsPatch = Pick<UserProfile, 'totalWorkouts' | 'totalActiveDays' | 'streak' | 'achievements' | 'xp' | 'level' | 'weeklyScore' | 'monthlyScore' | 'score'> & {
  totalTimeSpent: number;
  totalXp?: number;
  lastCheckIn: string | null;
};

function stopPrivateActivitySurfaces(preserveNativeBuffer = false) {
  localStorage.removeItem('kmfatal_active_run');
  localStorage.removeItem('kmfatal_start_time');
  localStorage.removeItem('kmfatal_total_distance');
  localStorage.removeItem('kmfatal_run_points');
  webGpsTrackingService.stop();
  // Durante o primeiro auth restore de uma conta válida, o localStorage pode
  // ter sido perdido enquanto o buffer nativo ainda contém a cauda da sessão
  // remota correta. Pare a coleta sem apagar esse lote até
  // sessionContinuityService comparar o sessionId. Logout/conta estrangeira
  // continuam usando stop(), que limpa owner + coordenadas persistidos.
  if (preserveNativeBuffer) {
    void nativeBackgroundLocationService.collectAndStop().catch(() => {});
  } else {
    void nativeBackgroundLocationService.stop().catch(() => {});
  }
  activityNotificationService.stop();
  activityLiveActivityService.stop();
}

function clearForeignOrGuestSession(nextUid: string | null) {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) {
      // Conta autenticada + sessão local ausente ainda pode ser um cold restore
      // legítimo. O owner nativo por sessionId decidirá depois se a cauda pode
      // ser reaplicada. Guest não possui esse direito: limpa imediatamente.
      stopPrivateActivitySurfaces(Boolean(nextUid));
      return;
    }

    const parsed = JSON.parse(raw) as { userId?: unknown };
    const ownerUid = typeof parsed?.userId === 'string' ? parsed.userId : null;

    // A sessão ativa é estado privado do atleta. Durante logout ela não pode
    // permanecer visível para o estado guest; durante troca de conta ela só
    // pode sobreviver se pertencer exatamente ao UID que o Firebase acabou de
    // autenticar. O documento remoto continua existindo e pode ser restaurado
    // com segurança quando o mesmo atleta entrar novamente.
    if (!nextUid || !ownerUid || ownerUid !== nextUid) {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
      // Owner explicitamente divergente é prova de estado estrangeiro e pode
      // ser destruído. Owner ausente/corrompido com usuário autenticado fica
      // apenas temporariamente preservado para a checagem por sessionId.
      const preserveNativeBuffer = Boolean(nextUid && !ownerUid);
      stopPrivateActivitySurfaces(preserveNativeBuffer);
    }
  } catch {
    // Estado corrompido/desconhecido nunca é promovido para a nova conta. Com
    // identidade válida, porém, o buffer nativo ainda pode provar o sessionId
    // correto durante a recuperação remota; guest limpa tudo.
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    stopPrivateActivitySurfaces(Boolean(nextUid));
  }
}

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
  const statsSyncRef = useRef<{ uid: string; promise: Promise<ActivityStatsPatch | null> } | null>(null);

  const reconcileActivityStats = useCallback(async (uid: string, generation: number): Promise<ActivityStatsPatch | null> => {
    if (statsSyncRef.current?.uid === uid) return statsSyncRef.current.promise;

    const promise = (async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser || currentUser.uid !== uid) return null;
        const token = await currentUser.getIdToken();
        if (generation !== generationRef.current || auth.currentUser?.uid !== uid) return null;
        const response = await fetch('/api/missions?action=sync-activity-stats', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: 'sync-activity-stats' }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.stats) return null;
        if (generation !== generationRef.current || auth.currentUser?.uid !== uid) return null;

        const stats: ActivityStatsPatch = {
          totalWorkouts: Math.max(0, Number(payload.stats.totalWorkouts) || 0),
          totalActiveDays: Math.max(0, Number(payload.stats.totalActiveDays) || 0),
          totalTimeSpent: Math.max(0, Number(payload.stats.totalTimeSpent) || 0),
          streak: Math.max(0, Number(payload.stats.streak) || 0),
          lastCheckIn: typeof payload.stats.lastCheckIn === 'string' ? payload.stats.lastCheckIn : null,
          achievements: Array.isArray(payload.stats.achievements)
            ? payload.stats.achievements.filter((value: unknown): value is string => typeof value === 'string')
            : [],
          xp: Math.max(0, Number(payload.stats.xp) || 0),
          totalXp: Math.max(0, Number(payload.stats.totalXp ?? payload.stats.xp) || 0),
          level: Math.max(1, Number(payload.stats.level) || 1),
          weeklyScore: Math.max(0, Number(payload.stats.weeklyScore) || 0),
          monthlyScore: Math.max(0, Number(payload.stats.monthlyScore) || 0),
          score: Math.max(0, Number(payload.stats.score) || 0),
        };
        setUser(current => current?.uid === uid ? { ...current, ...stats } : current);
        return stats;
      } catch (error: any) {
        console.warn(`[AUTH] [ACTIVITY_STATS] [${uid}] [WARNING] ${error?.message || 'Falha ao reconciliar estatísticas'}`);
        return null;
      } finally {
        if (statsSyncRef.current?.uid === uid) statsSyncRef.current = null;
      }
    })();

    statsSyncRef.current = { uid, promise };
    return promise;
  }, []);

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
        // Não bloqueia a primeira pintura do app: o perfil aparece imediatamente
        // e os contadores derivados são reconciliados em seguida pelo servidor.
        // A resposta só é aplicada se a mesma conta/geração continuar ativa.
        void reconcileActivityStats(uid, generation);
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
        void reconcileActivityStats(uid, generation);
        console.log(`[AUTH] [ENSURE_PROFILE] [${uid}] [SUCCESS] Perfil mínimo criado no servidor`);
      }
      setLoading(false);
      return userData;
    } catch (error: any) {
      console.error(`[AUTH] [LOAD_PROFILE] [${uid}] [FAILURE] Erro ao carregar perfil: ${error.message}`);
      if (!isStale()) setLoading(false);
      return null;
    }
  }, [ensureProfileViaServer, reconcileActivityStats]);

  const refreshUser = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const uid = currentUser.uid;
      const generation = generationRef.current;
      console.log(`[AUTH] [REFRESH_USER] [${uid}] [INFO] Recarregando perfil do usuário`);
      const refreshed = await loadUserProfile(uid, generation);

      // Um refresh explícito normalmente fecha uma ação importante (por
      // exemplo, finalizar uma atividade). loadUserProfile() já dispara a
      // reconciliação canônica e guarda a Promise em statsSyncRef; aguardar a
      // MESMA Promise aqui transforma refreshUser() em uma barreira sem criar
      // uma segunda chamada. Assim, quando o fluxo de cardio termina, a
      // reconciliação de Buscar Objetivo também já teve chance de concluir.
      const pendingStatsSync = statsSyncRef.current;
      if (pendingStatsSync?.uid === uid) {
        await pendingStatsSync.promise;
      }
      return refreshed;
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
      clearForeignOrGuestSession(firebaseUser?.uid || null);

      // Push também é estado privado da identidade. O token nativo pertence ao
      // aparelho, então precisa ser invalidado no logout ou reivindicado pela
      // conta nova. A rotina não solicita nova permissão: ela só reconcilia uma
      // autorização já concedida pelo usuário.
      void reconcilePushNotificationsForAuthChange(firebaseUser?.uid || null).catch((error: any) => {
        console.error(`[AUTH] [PUSH] [${firebaseUser?.uid || 'GUEST'}] [FAILURE] ${error?.message || 'Falha ao reconciliar dispositivo'}`);
      });

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

  // O subtree do aplicativo também é escopado ao UID autenticado. Isso força
  // páginas com estado próprio (Musculação, Cardio, Saúde, Perfil etc.) a serem
  // desmontadas e recriadas quando a identidade muda, em vez de carregarem
  // arrays, planos, modais ou sessões da conta anterior até o próximo efeito.
  const authScopeKey = auth.currentUser?.uid || 'guest';

  // Removed UI-blocking quota screen per user request
  return (
    <UserContext.Provider value={{ user, loading, refreshUser }}>
      <React.Fragment key={authScopeKey}>{children}</React.Fragment>
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);