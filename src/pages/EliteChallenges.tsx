import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Zap, 
  Trophy, 
  Shield, 
  Crown, 
  Star, 
  Timer, 
  Users, 
  ArrowRight, 
  TrendingUp, 
  Lock, 
  CheckCircle2, 
  Flame, 
  XCircle,
  AlertCircle,
  Calendar,
  History,
  Info,
  ChevronRight,
  TrendingDown,
  Activity,
  Medal,
  Award,
  Circle,
  X,
  CreditCard,
  Target,
  BarChart3,
  Dna
} from 'lucide-react';
import { cn } from '../lib/utils';
import { auth as fbAuth, db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../UserContext';
import { getLevelFromXP } from '../lib/levelUtils';
import { eliteChallengeService, Season, EliteChallenge, UserEliteChallenge } from '../services/eliteChallengeService';
import { stravaService, StravaStatus } from '../services/stravaService';
import { QuotaExhaustedError } from '../services/errors';
import { usePro } from '../ProContext';

// premium assets for a cinematographic feel
const ELITE_IMAGES = {
  BANNER: "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?q=80&w=2070&auto=format&fit=crop", 
  // Medals with mythology/elite theme
  MEDAL_IGNITE: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=800&auto=format&fit=crop", 
  MEDAL_PULSE: "https://images.unsplash.com/photo-1599586120429-48281b6f0ece?q=80&w=800&auto=format&fit=crop", 
  MEDAL_APEX: "https://images.unsplash.com/photo-1576733274294-87428af46243?q=80&w=800&auto=format&fit=crop", 
  MEDAL_TITAN: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=800&auto=format&fit=crop", 
  MEDAL_HORIZON: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=800&auto=format&fit=crop", 
  MEDAL_BLACK_ROUTE: "https://images.unsplash.com/photo-1605810230434-7631ac76ec81?q=80&w=800&auto=format&fit=crop", 
  ATHLETE: "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?q=80&w=2070&auto=format&fit=crop",
  MEDAL_GOLD: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=800&auto=format&fit=crop",
  MEDAL_SILVER: "https://images.unsplash.com/photo-1599586120429-48281b6f0ece?q=80&w=800&auto=format&fit=crop",
  MEDAL_BRONZE: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=800&auto=format&fit=crop",
  ATHLETE_RUNNING: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=2070&auto=format&fit=crop"
};

const MOCK_SEASON: Season = {
  id: 'elite_v1',
  name: 'ENDEAVOR',
  theme: 'JORNADA INDIVIDUAL',
  medalIcon: ELITE_IMAGES.MEDAL_IGNITE,
  startDate: '2026-05-01T00:00:00Z',
  endDate: '2026-12-31T00:00:00Z',
  totalPool: 0,
  athletesCount: 0,
  status: 'active',
  description: 'SUPERAÇÃO. DISCIPLINA. ENDURANCE.'
};

const CHALLENGE_TEMPLATES: EliteChallenge[] = [
  // 30 DIAS
  { id: 'ignite_80', seasonId: 'elite_v1', name: 'IGNITE', km: 80, days: 30, difficulty: 'Baixa', rarity: 'Comum', finishRate: 65, entryFee: 99.9, quotaMultiplier: 2.0 },
  { id: 'pulse_120', seasonId: 'elite_v1', name: 'PULSE', km: 120, days: 30, difficulty: 'Média', rarity: 'Rara', finishRate: 45, entryFee: 99.9, quotaMultiplier: 3.5 },
  { id: 'apex_160', seasonId: 'elite_v1', name: 'APEX', km: 160, days: 30, difficulty: 'Alta', rarity: 'Épica', finishRate: 25, entryFee: 99.9, quotaMultiplier: 5.0 },
  { id: 'titan_220', seasonId: 'elite_v1', name: 'TITAN', km: 220, days: 30, difficulty: 'Extrema', rarity: 'Mística', finishRate: 12, entryFee: 99.9, quotaMultiplier: 8.5 },
  
  // 60 DIAS
  { id: 'horizon_180', seasonId: 'elite_v1', name: 'HORIZON', km: 180, days: 60, difficulty: 'Baixa', rarity: 'Comum', finishRate: 55, entryFee: 99.9, quotaMultiplier: 2.5 },
  { id: 'elevate_260', seasonId: 'elite_v1', name: 'ELEVATE', km: 260, days: 60, difficulty: 'Média', rarity: 'Rara', finishRate: 35, entryFee: 99.9, quotaMultiplier: 4.0 },
  { id: 'velocity_340', seasonId: 'elite_v1', name: 'VELOCITY', km: 340, days: 60, difficulty: 'Alta', rarity: 'Épica', finishRate: 18, entryFee: 99.9, quotaMultiplier: 6.5 },
  { id: 'iron_path_450', seasonId: 'elite_v1', name: 'IRON PATH', km: 450, days: 60, difficulty: 'Extrema', rarity: 'Mística', finishRate: 8, entryFee: 99.9, quotaMultiplier: 12.0 },
  
  // 90 DIAS
  { id: 'odyssey_320', seasonId: 'elite_v1', name: 'ODYSSEY', km: 320, days: 90, difficulty: 'Baixa', rarity: 'Comum', finishRate: 45, entryFee: 99.9, quotaMultiplier: 3.0 },
  { id: 'black_route_500', seasonId: 'elite_v1', name: 'BLACK ROUTE', km: 500, days: 90, difficulty: 'Média', rarity: 'Rara', finishRate: 25, entryFee: 99.9, quotaMultiplier: 6.0 },
  { id: 'eternal_pace_700', seasonId: 'elite_v1', name: 'ETERNAL PACE', km: 700, days: 90, difficulty: 'Alta', rarity: 'Épica', finishRate: 12, entryFee: 99.9, quotaMultiplier: 10.0 },
  { id: 'immortal_1000', seasonId: 'elite_v1', name: 'IMMORTAL', km: 1000, days: 90, difficulty: 'Lendária', rarity: 'Mística', finishRate: 3, entryFee: 99.9, quotaMultiplier: 25.0 },
];

const getMedalForChallenge = (challengeId: string) => {
  const id = (challengeId || '').toLowerCase();
  if (id.includes('ignite')) return ELITE_IMAGES.MEDAL_IGNITE;
  if (id.includes('pulse')) return ELITE_IMAGES.MEDAL_PULSE;
  if (id.includes('apex')) return ELITE_IMAGES.MEDAL_APEX;
  if (id.includes('titan')) return ELITE_IMAGES.MEDAL_TITAN;
  if (id.includes('horizon')) return ELITE_IMAGES.MEDAL_HORIZON;
  if (id.includes('elevate')) return ELITE_IMAGES.MEDAL_PULSE;
  if (id.includes('velocity')) return ELITE_IMAGES.MEDAL_APEX;
  if (id.includes('iron_path')) return ELITE_IMAGES.MEDAL_TITAN;
  if (id.includes('odyssey')) return ELITE_IMAGES.MEDAL_HORIZON;
  if (id.includes('black_route')) return ELITE_IMAGES.MEDAL_BLACK_ROUTE;
  if (id.includes('eternal_pace')) return ELITE_IMAGES.MEDAL_TITAN;
  if (id.includes('immortal')) return ELITE_IMAGES.MEDAL_APEX;
  return ELITE_IMAGES.MEDAL_GOLD;
};

export function EliteChallenges() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { showProInvitation } = usePro();
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [availableChallenges, setAvailableChallenges] = useState<EliteChallenge[]>([]);
  const [userChallenges, setUserChallenges] = useState<UserEliteChallenge[]>([]);
  const [stravaStatus, setStravaStatus] = useState<StravaStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterDays, setFilterDays] = useState<number | 'all'>('all');
  const [feed, setFeed] = useState<any[]>([]);
  const [ranking, setRanking] = useState<any[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [selectedChallenge, setSelectedChallenge] = useState<EliteChallenge | null>(null);
  const [pollingStatus, setPollingStatus] = useState<'idle' | 'polling' | 'approved' | 'rejected' | 'pending' | 'processing' | 'error'>('idle');
  const [pendingPayments, setPendingPayments] = useState<any[]>([]);

  useEffect(() => {
    if (!user) {
      setPendingPayments([]);
      return;
    }

    const fetchPendingPayments = async () => {
      try {
        const q = query(
          collection(db, 'payments'),
          where('userId', '==', user.uid)
        );
        const snap = await getDocs(q);
        const pending = snap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((p: any) => p.status === 'pending' || p.status === 'processing');
        
        console.log('[EliteChallenges] Fetched pending payments on mount/change:', pending);
        setPendingPayments(pending);
      } catch (err) {
        console.error('[EliteChallenges] Error loading pending payments:', err);
        handleFirestoreError(err, OperationType.GET, 'payments');
      }
    };

    fetchPendingPayments();
  }, [user, userChallenges]);

  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      if (!isMounted) return;
      setLoading(true);
      
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), 5000));
      
      try {
        const loadData = async () => {
          let season = await eliteChallengeService.getActiveSeason();
          if (!season) {
            season = MOCK_SEASON;
          }
          
          if (season.medalIcon?.includes('1628155930542')) {
            season.medalIcon = ELITE_IMAGES.MEDAL_IGNITE;
          }
          setActiveSeason(season);
          
          if (!isMounted) return;

          let challenges = await eliteChallengeService.getSeasonChallenges(season.id);
          if (challenges.length === 0) challenges = CHALLENGE_TEMPLATES;
          if (!isMounted) return;
          setAvailableChallenges(challenges);

          if (user) {
            const myChallenges = await eliteChallengeService.getUserChallenges(user.uid);
            if (isMounted) setUserChallenges(myChallenges);
            
            const sStatus = await stravaService.getStatus();
            if (isMounted) setStravaStatus(sStatus);
          }

          const events = await eliteChallengeService.getEliteFeed();
          if (isMounted) setFeed(events);

          const rank = season ? await eliteChallengeService.getSeasonRanking(season.id) : [];
          if (isMounted) setRanking(rank);
        };

        await Promise.race([loadData(), timeoutPromise]);
      } catch (error: any) {
        console.error('Error fetching elite data:', error);
        if (error instanceof QuotaExhaustedError) {
          showProInvitation(error.message);
        }
        if (isMounted && !activeSeason) setActiveSeason(MOCK_SEASON);
        if (isMounted && availableChallenges.length === 0) setAvailableChallenges(CHALLENGE_TEMPLATES);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchData();
    return () => { isMounted = false; };
  }, [user]);

  const startPollingFlow = async (prefId: string, payId: string) => {
    if (!user) return;
    console.log('[EliteChallenges] Initiating payment confirmation polling for pref:', prefId);
    setPollingStatus('polling');
    
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts * 2s = 60 seconds
    const intervalTime = 2000; // 2 seconds

    const poll = async () => {
      try {
        const idToken = fbAuth.currentUser ? await fbAuth.currentUser.getIdToken() : '';
        const url = `/api/mercadopago?action=payment-status&preferenceId=${encodeURIComponent(prefId)}&challengeId=${selectedChallenge?.id || ''}`;
        
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${idToken}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          console.log('[EliteChallenges] Polling response status:', data.status);
          
          if (data.status === 'approved' || data.status === 'already_active') {
            setPollingStatus('approved');
            const updated = await eliteChallengeService.getUserChallenges(user.uid);
            setUserChallenges(updated);
            
            // Clean URL query params safely without reloading
            window.history.replaceState({}, document.title, window.location.pathname);
            return true; // Stop polling
          } else if (data.status === 'rejected') {
            setPollingStatus('rejected');
            window.history.replaceState({}, document.title, window.location.pathname);
            return true; // Stop polling
          } else if (data.status === 'pending' || data.status === 'processing') {
            setPollingStatus('processing');
          }
        }
      } catch (err) {
        console.error('[EliteChallenges] Polling request error:', err);
      }
      
      attempts++;
      if (attempts >= maxAttempts) {
        setPollingStatus('pending'); // timeout fallback
        return true; // Stop polling
      }
      return false; // Continue polling
    };

    const stopDoc = await poll();
    if (stopDoc) return;

    const timer = setInterval(async () => {
      const stop = await poll();
      if (stop) {
        clearInterval(timer);
      }
    }, intervalTime);
  };

  useEffect(() => {
    if (!user || loading) return;
    
    const params = new URLSearchParams(window.location.search);
    const paymentResult = params.get('payment');
    const prefId = params.get('preference_id') || params.get('preferenceId');
    const statusParam = params.get('status');

    if (paymentResult === 'success' || paymentResult === 'pending' || statusParam === 'approved' || prefId) {
      // Clean query parameters from URL immediately to prevent duplicate polling on reload
      window.history.replaceState({}, document.title, window.location.pathname);
      startPollingFlow(prefId || '', statusParam || '');
    } else if (paymentResult === 'failure' || statusParam === 'rejected') {
      window.history.replaceState({}, document.title, window.location.pathname);
      setPollingStatus('rejected');
    }
  }, [user, loading]);

  const activeUserChallenge = userChallenges.find(c => c.status === 'active');

  const handleJoinChallenge = async (challenge: EliteChallenge) => {
    if (!user) { navigate('/login'); return; }
    console.log('[EliteChallenges] Starting payment redirect flow for:', challenge.id);
    setJoiningId(challenge.id);
    try {
      const season = activeSeason || MOCK_SEASON;
      const idToken = fbAuth.currentUser ? await fbAuth.currentUser.getIdToken() : '';
      
      const response = await fetch('/api/mercadopago?action=create-preference', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          challengeId: challenge.id,
          challengeName: challenge.name,
          entryFee: challenge.entryFee,
          userId: user.uid,
          userName: user.displayName || 'Atleta',
          userPhoto: user.photoURL || '',
          seasonId: season.id
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Erro ao gerar o link de pagamento.');
      }

      let prefResult: any;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        prefResult = await response.json();
      } else {
        const text = await response.text();
        console.error('[EliteChallenges checkout error - non-JSON]', text);
        throw new Error('O servidor de pagamentos retornou uma resposta inesperada. Entre em contato com o suporte ou tente novamente.');
      }
      if (prefResult.init_point) {
        console.log('[EliteChallenges] Redirecting to MercadoPago init_point:', prefResult.init_point);
        window.location.href = prefResult.init_point;
      } else {
        throw new Error('Retorno inválido do servidor de pagamentos.');
      }
    } catch (error: any) {
      console.error('[EliteChallenges] Checkout error:', error);
      alert(error.message || 'Erro inesperado ao gerar link de pagamento do Mercado Pago.');
    } finally {
      setJoiningId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Zap className="text-primary animate-pulse w-12 h-12" />
          <p className="font-headline italic font-black text-on-surface-variant uppercase tracking-[0.3em] animate-pulse">SINCRONIZANDO ELITE...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-on-surface pb-32">
      <div className="sticky top-16 md:top-20 z-40 bg-background/90 backdrop-blur-2xl border-b border-white/[0.03] px-4 md:px-6">
         <div className="max-w-screen-xl mx-auto flex gap-4 md:gap-8 overflow-x-auto no-scrollbar whitespace-nowrap">
            <button className="h-12 md:h-14 border-b-2 border-primary text-primary text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] px-1 shrink-0">EXPLORAR</button>
            <button className="h-12 md:h-14 border-b-2 border-transparent text-on-surface-variant/40 hover:text-white text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] px-1 shrink-0">MEUS DESAFIOS</button>
            <button className="h-12 md:h-14 border-b-2 border-transparent text-on-surface-variant/40 hover:text-white text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] px-1 shrink-0">HISTÓRICO</button>
         </div>
      </div>

      {pollingStatus !== 'idle' && (
        <div className="max-w-screen-xl mx-auto px-4 mt-6">
          <div className={`p-6 rounded-[24px] border flex flex-col md:flex-row items-center justify-between gap-4 transition-all duration-300 ${
            pollingStatus === 'polling' || pollingStatus === 'processing'
              ? 'bg-primary/5 border-primary/20 text-primary'
              : pollingStatus === 'approved'
              ? 'bg-green-500/5 border-green-500/20 text-green-400'
              : pollingStatus === 'rejected'
              ? 'bg-red-500/5 border-red-500/20 text-red-400'
              : 'bg-yellow-500/5 border-yellow-500/20 text-yellow-400'
          }`}>
            <div className="flex items-center gap-4 text-left">
              {(pollingStatus === 'polling' || pollingStatus === 'processing') && (
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
              )}
              {pollingStatus === 'approved' && (
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 shrink-0">
                  <CheckCircle2 size={18} />
                </div>
              )}
              {pollingStatus === 'rejected' && (
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-red-500 shrink-0">
                  <XCircle size={18} />
                </div>
              )}
              {pollingStatus === 'pending' && (
                <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500 shrink-0">
                  <AlertCircle size={18} />
                </div>
              )}
              <div>
                <h4 className="font-headline italic font-black text-sm uppercase tracking-wider leading-tight">
                  {pollingStatus === 'polling' && 'Confirmando seu pagamento...'}
                  {pollingStatus === 'processing' && 'Seu pagamento está sendo analisado'}
                  {pollingStatus === 'approved' && 'Pagamento aprovado com sucesso!'}
                  {pollingStatus === 'rejected' && 'Pagamento recusado ou cancelado'}
                  {pollingStatus === 'pending' && 'Pagamento ainda em análise'}
                </h4>
                <p className="text-xs text-on-surface-variant font-medium mt-1 leading-relaxed">
                  {pollingStatus === 'polling' && 'Confirmando seu pagamento com o Mercado Pago... Aguarde um momento. Não feche esta tela.'}
                  {pollingStatus === 'processing' && 'Seu pagamento está sendo analisado pelo Mercado Pago. Isso pode levar alguns instantes.'}
                  {pollingStatus === 'approved' && 'Seu desafio já está ativo e você faz parte da elite! Comece a treinar quando quiser.'}
                  {pollingStatus === 'rejected' && 'Seu pagamento foi recusado ou cancelado pelo Mercado Pago. Por favor, tente novamente ou use outro cartão.'}
                  {pollingStatus === 'pending' && 'Não conseguimos obter aprovação imediata do Mercado Pago. Se você já pagou, a ativação ocorrerá automaticamente em alguns minutos.'}
                </p>
              </div>
            </div>
            
            {pollingStatus !== 'polling' && pollingStatus !== 'processing' && (
              <button 
                onClick={() => setPollingStatus('idle')} 
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-on-surface text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shrink-0"
              >
                FECHAR
              </button>
            )}
          </div>
        </div>
      )}

      <section className="mt-4 md:mt-8 px-4 md:px-0">
        <div className="max-w-screen-xl mx-auto relative rounded-[32px] md:rounded-[40px] overflow-hidden group border border-white/[0.05] bg-surface-container-lowest h-[350px] md:h-[500px]">
          <div className="absolute inset-0 z-0">
             <img 
               src={ELITE_IMAGES.BANNER} 
               onError={(e) => {
                 const target = e.target as HTMLImageElement;
                 target.src = "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?q=80&w=2070&auto=format&fit=crop";
               }}
               alt="" 
               referrerPolicy="no-referrer" 
               className="w-full h-full object-cover opacity-40 grayscale group-hover:grayscale-0 transition-all duration-[4s]" 
             />
             <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
          </div>

          <div className="relative z-10 p-6 md:p-12 h-full flex flex-col justify-center">
            <div className="space-y-4 max-w-2xl text-left">
              <span className="text-primary font-black text-[10px] md:text-[14px] uppercase tracking-[0.4em]">{activeSeason?.status === 'active' ? 'ENDEAVOR: CERTIFICAÇÃO DE PERFORMANCE ESPORTIVA' : 'BREVEMENTE: NOVA JORNADA'}</span>
              <h1 className="font-headline italic font-black text-5xl md:text-9xl leading-[0.8] uppercase tracking-tighter">
                {activeSeason?.status === 'active' ? 'VALIDE' : 'PRÓXIMO' } <br />
                <span className="text-transparent border-t-2 border-b-2 border-white/20 px-2">{activeSeason?.status === 'active' ? 'METAS' : 'META'}</span>
              </h1>
              <div className="flex items-center gap-4 md:gap-6 pt-4 border-l-2 border-primary pl-4 md:pl-6">
                 <div>
                   <p className="text-[8px] md:text-[10px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">PROGRAMA</p>
                   <p className="text-base md:text-2xl font-black italic text-white leading-none">CERTIFICAÇÃO INDIVIDUAL</p>
                 </div>
                 <div className="w-px h-8 md:h-10 bg-white/10" />
                 <div>
                   <p className="text-[8px] md:text-[10px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">CONQUISTAS</p>
                   <p className="text-base md:text-2xl font-black italic text-white leading-none">DISTINTIVOS E MEDALHAS</p>
                 </div>
              </div>
            </div>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1/2 h-full hidden lg:flex items-center justify-center">
               <motion.div animate={{ y: [0, -20, 0], rotate: [0, 5, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} className="relative w-96 h-96">
                  <div className="absolute inset-0 bg-primary/20 blur-[120px] rounded-full animate-pulse" />
                  <img 
                    src={activeSeason?.medalIcon || ELITE_IMAGES.MEDAL_GOLD} 
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = ELITE_IMAGES.MEDAL_GOLD;
                    }}
                    className="w-full h-full object-contain relative z-10 drop-shadow-[0_40px_100px_rgba(0,0,0,1)]" 
                    referrerPolicy="no-referrer" 
                  />
               </motion.div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 md:px-6 mb-8 mt-8 md:mt-12">
         <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-white/5 pb-6">
            <h3 className="font-headline italic font-black text-xl md:text-2xl uppercase tracking-widest">ESCOLHA SEU CIRCUITO DE CERTIFICAÇÃO</h3>
            <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5 overflow-x-auto no-scrollbar">
                <FilterTab label="30 DIAS" active={filterDays === 30} onClick={() => setFilterDays(30)} />
                <FilterTab label="60 DIAS" active={filterDays === 60} onClick={() => setFilterDays(60)} />
                <FilterTab label="90 DIAS" active={filterDays === 90} onClick={() => setFilterDays(90)} />
                <FilterTab label="TODOS" active={filterDays === 'all'} onClick={() => setFilterDays('all')} />
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
              {!stravaStatus?.connected ? (
                <button onClick={async () => { const url = await stravaService.authorize(); window.location.href = url; }} className="px-6 py-3 bg-[#FC4C02] text-white rounded-xl font-headline italic font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2">CONECTAR STRAVA <Zap size={14} fill="currentColor" /></button>
              ) : (
                <button onClick={async () => { setSyncing(true); try { const res = await stravaService.sync(); alert(`${res.syncCount} atividades sincronizadas!`); } finally { setSyncing(false); } }} disabled={syncing} className="px-6 py-3 bg-white/5 hover:bg-white/10 text-on-surface rounded-xl font-headline italic font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 border border-white/5">{syncing ? 'SINCRONIZANDO...' : 'SINCRONIZAR STRAVA'} <TrendingUp size={14} /></button>
              )}
            </div>
         </div>
      </section>

      <section className="px-4 md:px-6 grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 mb-12">
        {availableChallenges.filter(c => filterDays === 'all' || c.days === filterDays).map((challenge) => {
          const pending = pendingPayments.find(p => p.challengeId === challenge.id);
          return (
            <ChallengeCard 
              key={challenge.id} 
              challenge={challenge} 
              onJoin={() => setSelectedChallenge(challenge)} 
              pendingPayment={pending}
              onCheckStatus={(prefId) => startPollingFlow(prefId, '')}
            />
          );
        })}
      </section>

      {activeUserChallenge && (
        <section className="px-4 md:px-6 mb-12">
          <h3 className="font-headline italic font-black text-xl md:text-2xl uppercase tracking-tight mb-6">CERTIFICAÇÃO EM ANDAMENTO</h3>
          <div className="bg-surface-container p-6 md:p-8 rounded-[32px] md:rounded-[40px] border border-primary/20 relative overflow-hidden group shadow-2xl">
             <div className="relative z-10 flex flex-col lg:flex-row gap-6 md:gap-8 items-center">
                <div className="w-24 h-24 md:w-32 md:h-32 relative shrink-0">
                   <svg className="w-full h-full -rotate-90">
                      <circle cx="48" cy="48" r="44" fill="transparent" stroke="currentColor" strokeWidth="6" className="text-white/5 md:hidden" />
                      <circle cx="64" cy="64" r="58" fill="transparent" stroke="currentColor" strokeWidth="8" className="text-white/5 hidden md:block" />
                      
                      <motion.circle cx="48" cy="48" r="44" fill="transparent" stroke="currentColor" strokeWidth="6" strokeDasharray={276} initial={{ strokeDashoffset: 276 }} animate={{ strokeDashoffset: 276 - (276 * (Math.min(1, activeUserChallenge.currentKm / activeUserChallenge.targetKm))) }} className="text-primary md:hidden" />
                      <motion.circle cx="64" cy="64" r="58" fill="transparent" stroke="currentColor" strokeWidth="8" strokeDasharray={364} initial={{ strokeDashoffset: 364 }} animate={{ strokeDashoffset: 364 - (364 * (Math.min(1, activeUserChallenge.currentKm / activeUserChallenge.targetKm))) }} className="text-primary hidden md:block" />
                   </svg>
                   <div className="absolute inset-0 flex items-center justify-center"><span className="font-headline italic font-black text-xl md:text-2xl leading-none">{Math.round((activeUserChallenge.currentKm / activeUserChallenge.targetKm) * 100)}%</span></div>
                </div>

                <div className="flex-1 space-y-4 w-full">
                   <div className="space-y-1 text-center lg:text-left">
                      <h4 className="font-headline italic font-black text-2xl md:text-3xl uppercase tracking-tighter leading-none">{activeUserChallenge.challengeName || activeUserChallenge.challengeId.toUpperCase().replace(/_/g, ' ')}</h4>
                      <p className="font-label text-[10px] md:text-xs font-black text-on-surface-variant uppercase tracking-[0.2em]">{activeUserChallenge.targetKm} KM</p>
                   </div>
                   <div className="flex items-center gap-4">
                      <div className="flex items-baseline gap-2 shrink-0">
                        <span className="font-headline italic font-black text-2xl md:text-4xl text-primary">{activeUserChallenge.currentKm.toFixed(1)}</span>
                        <span className="font-headline italic font-black text-lg md:text-2xl text-on-surface-variant/40">/ {activeUserChallenge.targetKm}</span>
                      </div>
                      <div className="h-1.5 md:h-2 flex-1 bg-white/5 rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, (activeUserChallenge.currentKm / activeUserChallenge.targetKm) * 100)}%` }} className="h-full bg-primary" />
                      </div>
                   </div>
                   <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 pt-2">
                      <StatusItem label="DIAS SEGUIDOS" value={activeUserChallenge.streak.toString()} icon={<Flame className="text-primary" size={14} />} />
                      <StatusItem label="DIAS RESTANTES" value={Math.max(0, Math.ceil((new Date(activeUserChallenge.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))).toString()} icon={<Calendar className="text-primary" size={14} />} />
                      <StatusItem label="ATIVIDADES" value={activeUserChallenge.activitiesCount.toString()} icon={<Activity className="text-primary" size={14} />} className="col-span-2 md:col-span-1" />
                   </div>
                </div>

                <div className="bg-black/40 p-6 md:p-8 rounded-[32px] border border-white/5 backdrop-blur-xl flex flex-col items-center justify-center w-full lg:min-w-[240px]">
                   <p className="font-label text-[9px] md:text-[10px] font-black text-primary uppercase tracking-widest mb-1 text-center">INCENTIVO PREVISTO</p>
                   <div className="flex flex-col items-center">
                     <span className="font-headline italic font-black text-2xl md:text-3xl text-white leading-none text-center">R$ {(activeSeason?.totalPool || 0).toFixed(2)}</span>
                     <p className="text-[7px] md:text-[8px] font-black text-on-surface-variant/60 uppercase tracking-widest mt-1 text-center">FUNDO DE MARKETING PROMOCIONAL</p>
                   </div>
                   <div className="mt-6 w-full space-y-3">
                      <p className="text-[8px] md:text-[10px] text-center text-on-surface-variant font-bold leading-relaxed uppercase">O VALOR PATROCINADO É CONCEDIDO ENTRE CONCLUINTES DO CIRCUITO</p>
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5 text-center">
                        <p className="text-[7px] md:text-[8px] font-black text-on-surface-variant uppercase tracking-widest mb-1">PESO DE CERTIFICAÇÃO</p>
                        <p className="font-headline italic font-black text-xs text-primary">{availableChallenges.find(c => c.id === activeUserChallenge.challengeId)?.quotaMultiplier || 1}X</p>
                      </div>
                   </div>
                </div>
             </div>
          </div>
        </section>
      )}

      <section className="px-6 grid grid-cols-1 md:grid-cols-2 gap-10 mb-12">
          <div className="space-y-6">
             <div className="flex items-center justify-between">
                <h3 className="font-headline italic font-black text-xl uppercase tracking-widest">CRÔNICA DE SUPERAÇÃO</h3>
                <button className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest hover:text-secondary italic opacity-40">MEMORIAIS &gt;</button>
             </div>
             <div className="space-y-3">
                {feed.length > 0 ? feed.map((item, i) => (
                  <div key={item.id || i} className="flex items-center justify-between p-5 bg-surface-container rounded-3xl border border-white/5 group hover:bg-surface-container-high">
                    <div className="flex items-center gap-4">
                       <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/10 grayscale opacity-40 group-hover:grayscale-0 group-hover:opacity-100 transition-all">
                         <img 
                           src={item.userPhoto ? item.userPhoto : `https://picsum.photos/seed/${item.userId || i}/100`} 
                           referrerPolicy="no-referrer"
                           onError={(e) => {
                             const target = e.target as HTMLImageElement;
                             target.src = `https://picsum.photos/seed/${item.userId || i}/100`;
                           }}
                           alt="" 
                           className="w-full h-full object-cover" 
                         />
                      </div>
                      <div>
                         <p className="text-[14px] font-bold text-on-surface leading-tight"><span className="text-on-surface-variant font-label text-[10px] mr-2 uppercase tracking-tight">ATLETA</span>{item.text}</p>
                         <p className="text-[10px] text-on-surface-variant/40 font-black uppercase tracking-widest mt-1">{item.timestamp ? `HÁ ALGUNS MINUTOS` : 'EM TEMPO REAL'}</p>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="p-10 text-center bg-surface-container rounded-[32px] border border-white/5 opacity-40"><p className="font-label text-[10px] font-black uppercase tracking-widest">AGUARDANDO CONQUISTAS...</p></div>
                )}
             </div>
          </div>

         <div className="space-y-6">
            <div className="flex items-center justify-between">
               <h3 className="font-headline italic font-black text-xl uppercase tracking-widest">RANKING DA TEMPORADA</h3>
               <button className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest hover:text-secondary italic opacity-40">VER TODOS &gt;</button>
            </div>
            <div className="bg-surface-container rounded-[40px] border border-white/5 overflow-hidden">
               {ranking.length > 0 ? (
                 <div className="divide-y divide-white/5">
                   {ranking.slice(0, 5).map((entry, idx) => (
                     <div key={entry.id || idx} className="flex items-center justify-between p-4 px-6 hover:bg-white/[0.02]">
                        <div className="flex items-center gap-4">
                           <span className={cn("font-headline italic font-black text-lg w-6", idx === 0 ? "text-primary" : "text-on-surface/40")}>{idx + 1}</span>
                           <img 
                             src={entry.userPhoto ? entry.userPhoto : `https://picsum.photos/seed/${entry.userId || idx}/100`} 
                             referrerPolicy="no-referrer"
                             onError={(e) => {
                               const target = e.target as HTMLImageElement;
                               target.src = `https://picsum.photos/seed/${entry.userId || idx}/100`;
                             }}
                             className="w-8 h-8 rounded-full grayscale opacity-60 object-cover" 
                           />
                           <div><p className="text-[12px] font-bold text-on-surface">{entry.userName || 'Atleta'}</p><p className="text-[8px] font-black text-on-surface-variant uppercase tracking-widest">{entry.challengeId?.split('_')[0] || 'DESAFIO'}</p></div>
                        </div>
                        <div className="text-right"><p className="text-[12px] font-black text-primary italic">{(entry.currentKm || 0).toFixed(1)} KM</p><p className="text-[8px] font-black text-on-surface-variant/40 uppercase tracking-widest">PROGRESSO</p></div>
                     </div>
                   ))}
                 </div>
               ) : (
                 <div className="p-10 text-center space-y-4"><Trophy size={28} className="text-on-surface-variant/20 mx-auto" /><p className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest">RANKING EM FORMAÇÃO</p></div>
               )}
            </div>
         </div>
      </section>

      <section className="px-6 mb-12">
         <div className="flex items-center justify-between mb-8"><h3 className="font-headline italic font-black text-xl md:text-2xl uppercase tracking-widest">MINHA PAREDE DE CERTIFICADOS</h3></div>
         <div className="grid grid-cols-2 lg:grid-cols-5 gap-6 mb-12">
            {userChallenges.map((c) => (
              <MedalCard key={c.id} name={c.challengeId.toUpperCase()} status={c.status} img={getMedalForChallenge(c.challengeId)} label={c.status === 'completed' ? 'FINISHER' : 'EM CURSO'} />
            ))}
            {userChallenges.length === 0 && <p className="col-span-full text-center text-on-surface-variant/40 font-black uppercase text-xs">Nenhuma medalha conquistada</p>}
         </div>

         <div className="bg-surface-container p-4 md:p-6 rounded-[24px] md:rounded-[32px] border border-white/5 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
            <MetricSummary icon={<CheckCircle2 />} label="CONCLUÍDOS" value={userChallenges.filter(c => c.status === 'completed').length.toString()} />
            <MetricSummary icon={<Activity />} label="KM TOTAL" value={userChallenges.reduce((acc, curr) => acc + curr.currentKm, 0).toFixed(1)} />
            <MetricSummary icon={<Crown />} label="LEVEL" value={getLevelFromXP(user?.xp || 0).toString()} />
            <MetricSummary icon={<Medal />} label="SCORE RANKING" value={(user?.score || 0).toString()} />
         </div>
      </section>

      {/* Challenge Selection & Payment Modal */}
      <AnimatePresence>
        {selectedChallenge && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setSelectedChallenge(null)}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-surface-container-low rounded-[32px] md:rounded-[40px] border border-white/10 overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar"
            >
              {/* Header */}
              <div className="relative h-40 md:h-48 bg-black overflow-hidden">
                <img 
                  src={ELITE_IMAGES.BANNER} 
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?q=80&w=2070&auto=format&fit=crop";
                  }}
                  alt="" 
                  className="w-full h-full object-cover opacity-30 grayscale" 
                />
                <div className="absolute inset-0 bg-gradient-to-t from-surface-container-low to-transparent" />
                <button 
                  onClick={() => setSelectedChallenge(null)}
                  className="absolute top-4 md:top-6 right-4 md:right-6 w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-on-surface transition-colors"
                >
                  <X size={20} />
                </button>
                <div className="absolute bottom-0 left-0 p-6 md:p-8 flex items-end gap-4 md:gap-6 w-full">
                  <div className="w-16 h-16 md:w-24 md:h-24 bg-black/40 rounded-2xl border border-white/10 backdrop-blur-md p-2 shrink-0">
                    <img 
                      src={getMedalForChallenge(selectedChallenge.id)} 
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = ELITE_IMAGES.MEDAL_GOLD;
                      }}
                      alt="" 
                      className="w-full h-full object-contain" 
                    />
                  </div>
                  <div className="pb-1 md:pb-2 overflow-hidden">
                    <span className="font-label text-[8px] md:text-[10px] font-black text-primary uppercase tracking-[0.3em]">{selectedChallenge.rarity}</span>
                    <h2 className="font-headline italic font-black text-2xl md:text-4xl uppercase tracking-tighter text-white truncate">{selectedChallenge.name}</h2>
                  </div>
                </div>
              </div>

              {/* Specs */}
              <div className="p-6 md:p-8 space-y-6 md:space-y-8">
                <div className="grid grid-cols-2 gap-3 md:gap-4">
                   <DetailBox icon={<Target className="text-primary" size={16} />} label="OBJETIVO KM" value={`${selectedChallenge.km} KM`} />
                   <DetailBox icon={<Calendar className="text-secondary" size={16} />} label="DURAÇÃO" value={`${selectedChallenge.days} DIAS`} />
                   <DetailBox icon={<BarChart3 className="text-tertiary" size={16} />} label="DIFICULDADE" value={selectedChallenge.difficulty} />
                   <DetailBox icon={<Dna className="text-primary" size={16} />} label="PESO DO CIRCUITO" value={`${selectedChallenge.quotaMultiplier}X`} />
                </div>

                <div className="bg-primary/5 border border-primary/20 p-5 md:p-6 rounded-3xl space-y-2">
                  <div className="flex justify-between items-center gap-2">
                    <span className="font-label text-[8px] md:text-[10px] font-black text-on-surface-variant uppercase tracking-widest">TAXA DE EMISSÃO DA CERTIFICAÇÃO</span>
                    <span className="font-headline italic font-black text-xl md:text-2xl text-primary whitespace-nowrap">R$ {selectedChallenge.entryFee.toFixed(2)}</span>
                  </div>
                  <p className="text-[8px] md:text-[9px] font-bold text-on-surface-variant/60 uppercase leading-relaxed">
                    INCLUI PROCESSAMENTO TÉCNICO DE EMISSÃO, VALIDAÇÃO INTEGRADA VIA STRAVA E ACESSO À PARTICIPAÇÃO EM PROGRAMAS DE INCENTIVO CONCEDIDOS POR PATROCINADORES.
                  </p>
                </div>

                <button 
                  onClick={() => handleJoinChallenge(selectedChallenge)}
                  disabled={joiningId === selectedChallenge.id}
                  className="w-full h-16 md:h-20 bg-primary text-black rounded-[24px] md:rounded-3xl font-headline italic font-black text-xl md:text-2xl uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-4"
                >
                  {joiningId === selectedChallenge.id ? 'PROCESSANDO...' : (
                    <>
                      HABILITAR CERTIFICAÇÃO ESPORTIVA <Zap size={20} fill="currentColor" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterTab({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) {
  return (<button onClick={onClick} className={cn("px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-label text-[8px] md:text-[10px] font-black uppercase tracking-widest whitespace-nowrap", active ? "bg-primary text-black" : "text-on-surface-variant/40 hover:text-on-surface hover:bg-white/5")}>{label}</button>);
}

function ChallengeCard({ 
  challenge, 
  onJoin, 
  isLoading,
  pendingPayment,
  onCheckStatus
}: { 
  challenge: EliteChallenge, 
  onJoin: () => void, 
  isLoading?: boolean,
  pendingPayment?: any,
  onCheckStatus?: (prefId: string) => void
}) {
  return (
    <div className="bg-surface-container p-6 rounded-[32px] border border-white/5 flex flex-col gap-6 group hover:border-secondary transition-all">
      <div className="space-y-1 text-left"><h4 className="font-headline italic font-black text-3xl uppercase tracking-tighter group-hover:text-primary">{challenge.name}</h4><p className="font-label text-xs text-on-surface-variant font-black uppercase tracking-widest">{challenge.km} KM • {challenge.days} DIAS</p></div>
       <div className="relative aspect-video rounded-[24px] overflow-hidden bg-black/40 border border-white/5 flex items-center justify-center">
         <img 
           src={ELITE_IMAGES.ATHLETE_RUNNING} 
           onError={(e) => {
             const target = e.target as HTMLImageElement;
             target.src = "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?q=80&w=2070&auto=format&fit=crop";
           }}
           alt="" 
           className="absolute inset-0 w-full h-full object-cover opacity-20 grayscale transition-all group-hover:grayscale-0 group-hover:scale-110" 
         />
         <div className="relative z-10 w-2/3 h-2/3 scale-110 group-hover:scale-125 transition-transform duration-700">
            <img 
              src={getMedalForChallenge(challenge.id)} 
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = ELITE_IMAGES.MEDAL_GOLD;
              }}
              alt="" 
              className="w-full h-full object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.8)]" 
            />
         </div>
      </div>
      <div className="space-y-4 pt-2 border-t border-white/[0.03]">
         <div className="flex justify-between items-center text-[10px] font-black text-on-surface-variant uppercase tracking-widest">
            <div><p>DIFICULDADE</p><p className="text-white text-base italic">{challenge.difficulty}</p></div>
            <div className="text-right"><p>RARIDADE</p><p className="text-primary text-base italic">{challenge.rarity}</p></div>
         </div>

         {pendingPayment && (
           <div className="flex items-center gap-2 text-yellow-500 text-[10px] font-black uppercase tracking-widest bg-yellow-500/5 border border-yellow-500/15 p-2 px-3 rounded-lg text-left">
             <AlertCircle size={12} className="animate-pulse shrink-0" />
             <span>Aguardando Pagamento</span>
           </div>
         )}

         <button 
           onClick={pendingPayment ? () => onCheckStatus?.(pendingPayment.preferenceId || pendingPayment.id) : onJoin} 
           disabled={isLoading}
           className={cn(
             "w-full py-4 rounded-2xl font-headline italic font-black text-xs uppercase tracking-[0.2em] transition-all",
             isLoading 
               ? "bg-white/10 text-on-surface-variant cursor-wait" 
               : pendingPayment
               ? "bg-yellow-500 text-black hover:bg-yellow-400"
               : "bg-primary text-black hover:bg-primary/80"
           )}
         >
           {isLoading ? 'INICIANDO...' : pendingPayment ? 'VERIFICAR STATUS' : 'REIVINDICAR CERTIFICADO'}
         </button>
      </div>
    </div>
  );
}

function DetailBox({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="bg-white/5 p-4 rounded-2xl border border-white/5 flex items-center gap-4">
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">{icon}</div>
      <div>
        <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest mb-1">{label}</p>
        <p className="font-headline italic font-black text-lg leading-none">{value}</p>
      </div>
    </div>
  );
}

function StatusItem({ label, value, icon, className }: { label: string, value: string, icon: React.ReactNode, className?: string }) {
  return (
    <div className={cn("bg-black/20 p-3 md:p-4 rounded-xl md:rounded-2xl border border-white/5 flex items-center gap-3 md:gap-4", className)}>
      <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="font-label text-[7px] md:text-[8px] font-black text-on-surface-variant uppercase tracking-widest mb-1 truncate">{label}</p>
        <p className="font-headline italic font-black text-base md:text-lg leading-none truncate">{value}</p>
      </div>
    </div>
  );
}

function MetricSummary({ icon, label, value }: { icon: any, label: string, value: string }) {
  return (
    <div className="flex items-center gap-4">
       <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-primary">{icon}</div>
       <div><p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">{label}</p><p className="font-headline italic font-black text-xl leading-none">{value}</p></div>
    </div>
  );
}

function MedalCard({ name, status, img, label }: { name: string, status: string, img: string, label: string }) {
  return (
    <div className={cn("bg-surface-container rounded-3xl border border-white/5 p-4 flex flex-col items-center gap-3", status === 'completed' ? 'border-primary/20' : 'opacity-40')}>
       <div className="relative w-20 h-20">
         <img 
           src={img} 
           onError={(e) => {
             const target = e.target as HTMLImageElement;
             target.src = "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=800&auto=format&fit=crop";
           }}
           alt="" 
           className={cn("w-full h-full object-contain drop-shadow-[0_5px_10px_rgba(0,0,0,0.5)]", status === 'locked' && 'opacity-20')} 
         />
       </div>
       <div className="text-center"><h5 className="font-headline italic font-black text-[10px] uppercase tracking-tight">{name}</h5><p className="font-label text-[7px] font-black uppercase tracking-widest text-on-surface-variant opacity-60">{label}</p></div>
    </div>
  );
}
