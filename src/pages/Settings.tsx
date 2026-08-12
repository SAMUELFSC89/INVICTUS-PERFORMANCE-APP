import React, { useState, useEffect, useRef } from 'react';
import { 
  User, Bell, Shield, Info, LogOut, ChevronRight, Camera, Save, ArrowLeft, Sun, Moon, X, 
  AlertTriangle, RefreshCw, TrendingUp, Calendar, ShieldCheck, Activity, Crown, Check, 
  CreditCard, Lock, CheckCircle, AlertCircle, Sparkles, ArrowUpRight, Heart, Dumbbell, 
  Watch, Building2, Trash2 
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { UserProfile } from '../types';
import { cn, compressImage } from '../lib/utils';
import { userService } from '../services/userService';
import { stravaService, StravaStatus } from '../services/stravaService';
import { motion, AnimatePresence } from 'motion/react';

import { useUser } from '../UserContext';
import { ScoringRules } from '../components/ScoringRules';
import { PhysiologicalDiagnostic } from '../components/PhysiologicalDiagnostic';
import { WearableManager } from '../services/wearables/WearableManager';
import { requestAllNativePermissions } from '../lib/nativePermissions';

type SubViewType = 
  | 'profile_edit'
  | 'wearables'
  | 'biometrics'
  | 'scientific_consent'
  | 'subscription'
  | 'scoring'
  | 'rules'
  | 'transparency'
  | 'about_ai'
  | 'faq'
  | 'performance_scoring'
  | 'usage'
  | 'privacy'
  | 'competition'
  | 'prizes'
  | null;

export function Settings() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refreshUser } = useUser();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Tab/Sub-view state - standardizing all functions as sub-page tabs
  const [activeSubView, setActiveSubView] = useState<SubViewType>(null);

  const [stravaStatus, setStravaStatus] = useState<StravaStatus | null>(null);
  const [isStravaLoading, setIsStravaLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Smartwatch states (Apple Watch, Garmin, Galaxy Watch, Fitbit)
  const [smartwatchConnected, setSmartwatchConnected] = useState<boolean>(() => {
    return localStorage.getItem('wearable_conn_apple_health') === 'true' || 
           localStorage.getItem('wearable_conn_health_connect') === 'true' || 
           localStorage.getItem('wearable_conn_strava') === 'true' ||
           localStorage.getItem('smartwatchConnected') === 'true';
  });
  const [appleConnected, setAppleConnected] = useState<boolean>(() => localStorage.getItem('wearable_conn_apple_health') === 'true');
  const [androidConnected, setAndroidConnected] = useState<boolean>(() => localStorage.getItem('wearable_conn_health_connect') === 'true');
  const [stravaConnected, setStravaConnected] = useState<boolean>(() => localStorage.getItem('wearable_conn_strava') === 'true');
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState<'apple_health' | 'health_connect' | 'strava' | null>(null);
  const [smartwatchHR, setSmartwatchHR] = useState<number>(75);

  // Research Consent state - LGPD guidelines
  const [researchConsent, setResearchConsent] = useState<boolean>(() => {
    if (user && (user as any).researchConsent !== undefined) {
      return (user as any).researchConsent;
    }
    return localStorage.getItem('researchConsent') === 'true';
  });
  const [isUpdatingConsent, setIsUpdatingConsent] = useState<boolean>(false);

  // Smartwatch mandatory agreement state for subscription checkout
  const [smartwatchAgreement, setSmartwatchAgreement] = useState<boolean>(false);
  const [requestingPerms, setRequestingPerms] = useState<boolean>(false);

  // Form states
  const [displayName, setDisplayName] = useState('');
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [height, setHeight] = useState<number>(0);
  const [weight, setWeight] = useState<number>(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
  });

  // Mercado Pago Payment states
  const [selectedPlan, setSelectedPlan] = useState<'invictus_open' | 'invictus_performance' | 'invictus_monthly' | 'invictus_annual'>('invictus_open');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [paymentStatusOverlay, setPaymentStatusOverlay] = useState<'success' | 'pending' | 'processing' | 'failure' | 'approved' | 'rejected' | null>(null);
  const [paymentStatusMessage, setPaymentStatusMessage] = useState('');

  // Biometric Historical Database Querying
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState<boolean>(false);

  // URL query parameter tab detection (e.g., /settings?tab=integrations)
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const tabParam = searchParams.get('tab');
    if (tabParam === 'integrations' || tabParam === 'wearables') {
      setActiveSubView('wearables');
    } else if (tabParam === 'subscription' || tabParam === 'pro') {
      setActiveSubView('subscription');
    } else if (tabParam === 'biometrics') {
      setActiveSubView('biometrics');
    } else if (tabParam === 'profile') {
      setActiveSubView('profile_edit');
    }
  }, [location.search]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setWhatsappEnabled(user.whatsappEnabled);
      setHeight(user.height || 0);
      setWeight(user.weight || 0);
      
      // Load Strava status
      stravaService.getStatus()
        .then(status => {
          setStravaStatus(status);
          const isSwConnected = !!status?.connected;
          setStravaConnected(isSwConnected);
          
          const isApple = localStorage.getItem('wearable_conn_apple_health') === 'true';
          const isAndroid = localStorage.getItem('wearable_conn_health_connect') === 'true';
          const unifiedConnected = isSwConnected || isApple || isAndroid;
          
          setSmartwatchConnected(unifiedConnected);
          localStorage.setItem('smartwatchConnected', String(unifiedConnected));
        })
        .catch(err => console.error('Failed to load Strava status:', err));
    }
  }, [user]);

  useEffect(() => {
    if (user?.uid) {
      const fetchMetrics = async () => {
        setLoadingMetrics(true);
        try {
          const q = query(
            collection(db, 'biometric_metrics'),
            where('userId', '==', user.uid)
          );
          const snap = await getDocs(q);
          const list = snap.docs.map(doc => doc.data());
          list.sort((a: any, b: any) => {
            const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return timeB - timeA;
          });
          setMetrics(list.slice(0, 15));
        } catch (err) {
          console.error('[Biometrics] Error fetching historical biometric metrics:', err);
        } finally {
          setLoadingMetrics(false);
        }
      };
      fetchMetrics();

      WearableManager.getInstance().loadConfig().then((cfg) => {
        setAppleConnected(!!cfg.appleHealthConnected);
        setAndroidConnected(!!cfg.healthConnectConnected);
        setStravaConnected(!!cfg.stravaConnected);
        setSmartwatchConnected(
          cfg.appleHealthConnected || 
          cfg.healthConnectConnected || 
          cfg.stravaConnected
        );
      }).catch(err => {
        console.warn('[Settings] Failed to sync wearables config:', err);
      });
    }
  }, [user]);

  // Live pulsating heartbeat simulator
  useEffect(() => {
    if (!smartwatchConnected) return;
    const interval = setInterval(() => {
      setSmartwatchHR(prev => {
        const delta = Math.floor(Math.random() * 5) - 2;
        const next = prev + delta;
        return next < 60 ? 60 : next > 100 ? 100 : next;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [smartwatchConnected]);

  useEffect(() => {
    refreshUser?.().catch(err => console.error('[Settings] Falha ao sincronizar perfil do usuário:', err));
  }, [refreshUser]);

  useEffect(() => {
    if (!auth.currentUser && !loading) {
      navigate('/');
    }
  }, [navigate, loading]);

  const handleRequestNativePermissions = async () => {
    setRequestingPerms(true);
    try {
      const summary = await requestAllNativePermissions();
      if (summary.allGranted) {
        setMessage({ type: 'success', text: 'Todas as permissões do dispositivo (GPS, Saúde, Sensores) foram ativadas com sucesso!' });
      } else {
        setMessage({ type: 'success', text: 'Permissões atualizadas no sistema Android.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Falha ao solicitar permissões do Android.' });
    } finally {
      setRequestingPerms(false);
    }
  };

  const handleToggleConsent = async (val: boolean) => {
    setResearchConsent(val);
    localStorage.setItem('researchConsent', String(val));
    if (user?.uid) {
      setIsUpdatingConsent(true);
      try {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, { researchConsent: val });
        setMessage({ type: 'success', text: `Consentimento de pesquisa atualizado para: ${val ? 'SIM (AUTORIZADO)' : 'NÃO (NEGADO)'}.` });
      } catch (err: any) {
        console.error('Error updating consent:', err);
        setMessage({ type: 'error', text: 'Não foi possível salvar o consentimento no banco de dados.' });
      } finally {
        setIsUpdatingConsent(false);
      }
    } else {
      setMessage({ type: 'success', text: `Consentimento preferido atualizado localmente para: ${val ? 'SIM' : 'NÃO'}.` });
    }
  };

  const handleDisconnectDevice = async (providerId: 'apple_health' | 'health_connect' | 'strava') => {
    setShowDisconnectConfirm(providerId);
  };

  const executeDisconnectDevice = async (providerId: 'apple_health' | 'health_connect' | 'strava') => {
    setShowDisconnectConfirm(null);
    if (providerId === 'strava') {
      setIsStravaLoading(true);
      try {
        await stravaService.disconnect();
        try {
          await WearableManager.getInstance().disconnectProvider('strava');
        } catch (e) {
          console.warn('[Settings] Failed to disconnect Strava in WearableManager:', e);
        }
        setStravaStatus(prev => prev ? { ...prev, connected: false } : null);
        setStravaConnected(false);
        
        const apple = appleConnected;
        const android = androidConnected;
        const unifiedConnected = apple || android;
        setSmartwatchConnected(unifiedConnected);
        localStorage.setItem('smartwatchConnected', String(unifiedConnected));
        setMessage({ type: 'success', text: 'Strava desconectado com sucesso.' });
      } catch (error) {
        console.error('Strava disconnect error:', error);
        setMessage({ type: 'error', text: 'Falha ao desconectar o Strava.' });
      } finally {
        setIsStravaLoading(false);
      }
      return;
    }
    
    const label = providerId === 'apple_health' ? 'Apple HealthKit' : 'Android Health Connect';
    setLoading(true);
    try {
      await WearableManager.getInstance().disconnectProvider(providerId);
      if (providerId === 'apple_health') {
        setAppleConnected(false);
      } else if (providerId === 'health_connect') {
        setAndroidConnected(false);
      }
      
      const apple = providerId === 'apple_health' ? false : appleConnected;
      const android = providerId === 'health_connect' ? false : androidConnected;
      const strava = stravaConnected;
      const unifiedConnected = apple || android || strava;
      setSmartwatchConnected(unifiedConnected);
      localStorage.setItem('smartwatchConnected', String(unifiedConnected));
      setMessage({ type: 'success', text: `${label} desconectado com sucesso.` });
    } catch (err: any) {
      console.error('Failed to disconnect device:', err);
      setMessage({ type: 'error', text: 'Falha ao desconectar o dispositivo.' });
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const compressed = await compressImage(file, 400, 0.8);
      await userService.updateProfilePhoto(compressed);
      setMessage({ type: 'success', text: 'Foto atualizada com sucesso!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('Failed to update photo:', error);
      setMessage({ type: 'error', text: 'Erro ao atualizar foto.' });
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!user) return;
    if (!window.confirm('Deseja realmente remover sua foto de perfil?')) return;

    setLoading(true);
    try {
      await userService.removeProfilePhoto();
      setMessage({ type: 'success', text: 'Foto de perfil removida com sucesso!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('Failed to remove photo:', error);
      setMessage({ type: 'error', text: 'Erro ao remover foto.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setLoading(true);
    setMessage(null);

    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: displayName,
        whatsappEnabled: whatsappEnabled,
        height: height,
        weight: weight
      });

      setMessage({ type: 'success', text: 'Perfil atualizado!' });
      setActiveSubView(null);
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao salvar.' });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyStorePurchase = async (platform: 'android' | 'ios') => {
    setPaymentLoading(true);
    setCheckoutError(null);
    setMessage(null);

    if (selectedPlan === 'invictus_performance') {
      if (!smartwatchConnected) {
        setCheckoutError('Para participar do Plano Performance é necessário conectar um smartwatch compatível. Isso permite uma avaliação mais justa do seu desempenho utilizando dados biométricos reais.');
        setPaymentLoading(false);
        return;
      }
      if (!smartwatchAgreement) {
        setCheckoutError('Você deve marcar e aceitar o termo de obrigatoriedade de uso de smartwatch para ativar a assinatura do Plano Performance.');
        setPaymentLoading(false);
        return;
      }
    }

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }

      const mockPurchaseToken = `token_${platform}_${Math.random().toString(36).substring(2, 11)}`;
      const mockTransactionId = `tx_${platform}_${Math.random().toString(36).substring(2, 11)}`;

      const response = await fetch('/api/payments/verify-purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          planId: selectedPlan,
          platform,
          purchaseToken: mockPurchaseToken,
          transactionId: mockTransactionId,
          scenario: 'approved'
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao validar a assinatura com a loja oficial.');
      }

      if (data.success && data.status === 'approved') {
        setPaymentStatusOverlay('success');
        setPaymentStatusMessage('Assinatura ativada com sucesso pelas lojas oficiais! Seu acesso Invictus Pro está liberado.');
        if (refreshUser) {
          await refreshUser();
        }
      } else {
        throw new Error('Falha na validação do recibo de compra.');
      }
    } catch (err: any) {
      console.error('[Store Purchase Error]', err);
      setCheckoutError(err.message || 'Erro de rede ou falha de processamento.');
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    navigate('/');
  };

  if (!user) return null;

  // Helper for sub-view headers
  const getSubViewHeader = (view: SubViewType) => {
    switch (view) {
      case 'profile_edit':
        return { title: 'EDITAR PERFIL', subtitle: 'Nome, foto, altura e peso' };
      case 'wearables':
        return { title: 'DISPOSITIVOS & SENSORES', subtitle: 'Smartwatch, Strava & Saúde' };
      case 'biometrics':
        return { title: 'DIAGNÓSTICO FISIOLÓGICO', subtitle: 'Score biológico, cardio e calorias' };
      case 'scientific_consent':
        return { title: 'CESSÃO CIENTÍFICA', subtitle: 'Programa de Pesquisa & LGPD' };
      case 'subscription':
        return { title: 'ASSINATURA INVICTUS PRO', subtitle: 'Planos Open e Performance' };
      case 'performance_scoring':
        return { title: 'FÓRMULA PERFORMANCE', subtitle: 'Score de Desempenho Biológico' };
      case 'scoring':
        return { title: 'ENTENDA O JOGO', subtitle: 'Como Funciona a Pontuação' };
      case 'rules':
        return { title: 'ENTENDA O JOGO', subtitle: 'Regras da Temporada' };
      case 'transparency':
        return { title: 'ENTENDA O JOGO', subtitle: 'Transparência e Validação' };
      case 'about_ai':
        return { title: 'INVICTUS IA', subtitle: 'Sobre a Invictus IA, Segurança e Isenção' };
      case 'faq':
        return { title: 'ENTENDA O JOGO', subtitle: 'Perguntas Frequentes (FAQ)' };
      case 'usage':
        return { title: 'TERMOS E POLÍTICAS', subtitle: 'Termos de Uso' };
      case 'privacy':
        return { title: 'TERMOS E POLÍTICAS', subtitle: 'Política de Privacidade' };
      case 'competition':
        return { title: 'TERMOS E POLÍTICAS', subtitle: 'Regras da Competição' };
      case 'prizes':
        return { title: 'TERMOS E POLÍTICAS', subtitle: 'Política de Premiação' };
      default:
        return { title: 'CONFIGURAÇÕES', subtitle: 'Central do Atleta' };
    }
  };

  // Helper renderer for sub-view content
  const renderSubViewContent = (view: SubViewType) => {
    switch (view) {
      case 'profile_edit':
        return (
          <div className="space-y-6">
            <div className="flex flex-col items-center justify-center gap-3 p-4 bg-surface-container-low rounded-3xl border border-white/5">
              <div className="relative">
                <div className="w-20 h-20 rounded-2xl overflow-hidden bg-surface-container-high border-2 border-primary/30 shadow-md">
                  <img 
                    src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid || 'athlete'}`} 
                    alt="Athlete Profile" 
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover" 
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid || 'athlete'}`;
                    }}
                  />
                </div>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 p-2 bg-primary text-on-primary rounded-xl border-2 border-surface-container-low shadow-md hover:scale-110 transition-transform cursor-pointer"
                  title="Alterar Foto"
                >
                  <Camera size={14} />
                </button>
                {user.photoURL ? (
                  <button 
                    onClick={handleRemovePhoto}
                    className="absolute -bottom-1 -left-1 p-2 bg-red-500/90 text-white rounded-xl border-2 border-surface-container-low shadow-md hover:scale-110 transition-transform cursor-pointer"
                    title="Remover Foto"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handlePhotoChange} />
              </div>
              <div className="flex items-center gap-3">
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[10px] text-primary font-bold uppercase tracking-wider hover:underline cursor-pointer"
                >
                  Alterar foto
                </button>
                {user.photoURL && (
                  <>
                    <span className="text-[10px] text-on-surface-variant">•</span>
                    <button 
                      type="button"
                      onClick={handleRemovePhoto}
                      className="text-[10px] text-red-400 font-bold uppercase tracking-wider hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <Trash2 size={10} />
                      Remover foto
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest">NOME DE GUERRA</label>
              <input 
                type="text" 
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-surface-container-high border-2 border-outline-variant/30 px-5 h-14 rounded-2xl font-headline italic font-black text-xl text-on-surface focus:border-primary focus:outline-none transition-all uppercase tracking-tighter"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest ml-1">ALTURA (CM)</label>
                <input 
                  type="number"
                  value={height}
                  onChange={e => setHeight(parseInt(e.target.value) || 0)}
                  className="w-full bg-surface-container-high border-2 border-outline-variant/30 px-4 h-12 rounded-xl text-on-surface focus:border-primary focus:outline-none transition-all font-bold text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest ml-1">PESO (KG)</label>
                <input 
                  type="number"
                  value={weight}
                  onChange={e => setWeight(parseInt(e.target.value) || 0)}
                  className="w-full bg-surface-container-high border-2 border-outline-variant/30 px-4 h-12 rounded-xl text-on-surface focus:border-primary focus:outline-none transition-all font-bold text-sm"
                />
              </div>
            </div>

            <div className="p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10 flex items-center justify-between">
              <div>
                <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest block">ALERTAS WHATSAPP</span>
                <span className="text-[10px] text-on-surface-variant font-medium">Receber resumos de treinos e conquistas</span>
              </div>
              <button 
                onClick={() => setWhatsappEnabled(!whatsappEnabled)}
                className={cn(
                  "w-10 h-5 rounded-full transition-all relative shrink-0",
                  whatsappEnabled ? "bg-primary" : "bg-surface-container-highest"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                  whatsappEnabled ? "left-5.5" : "left-0.5"
                )} />
              </button>
            </div>

            <button 
              onClick={handleSave}
              disabled={loading}
              className="w-full bg-primary text-on-primary h-14 rounded-2xl font-headline italic font-black text-lg uppercase tracking-widest shadow-lg shadow-primary/20 flex items-center justify-center gap-3 cursor-pointer"
            >
              {loading ? <RefreshCw className="animate-spin" /> : "SALVAR ALTERAÇÕES"}
            </button>
          </div>
        );

      case 'wearables':
        return (
          <div className="space-y-6">
            <div className="bg-surface-container-low rounded-[28px] border border-emerald-500/10 p-5 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                  <Watch size={24} />
                </div>
                <div>
                  <h3 className="font-headline italic font-black text-lg text-on-surface uppercase leading-none">DISPOSITIVOS CONECTADOS</h3>
                  <p className="font-label text-[8px] text-emerald-400 uppercase tracking-widest mt-1 font-black">
                    Nativo: Apple HealthKit, Health Connect & Strava
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="p-3.5 bg-surface-container-high/40 border border-outline-variant/10 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="block font-label text-[8px] uppercase tracking-widest text-on-surface-variant opacity-60 font-black">Apple HealthKit</span>
                    <span className="font-headline italic font-black text-xs uppercase text-on-surface mt-0.5 block">
                      {appleConnected ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle size={12} /> ATIVO</span> : <span className="text-on-surface-variant/50">DESCONECTADO</span>}
                    </span>
                  </div>
                  {appleConnected && (
                    <button type="button" onClick={() => handleDisconnectDevice('apple_health')} className="text-[10px] font-black text-red-400 hover:text-red-300 uppercase tracking-wider cursor-pointer">
                      Desconectar
                    </button>
                  )}
                </div>

                <div className="p-3.5 bg-surface-container-high/40 border border-outline-variant/10 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="block font-label text-[8px] uppercase tracking-widest text-on-surface-variant opacity-60 font-black">Android Health Connect</span>
                    <span className="font-headline italic font-black text-xs uppercase text-on-surface mt-0.5 block">
                      {androidConnected ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle size={12} /> ATIVO</span> : <span className="text-on-surface-variant/50">DESCONECTADO</span>}
                    </span>
                  </div>
                  {androidConnected && (
                    <button type="button" onClick={() => handleDisconnectDevice('health_connect')} className="text-[10px] font-black text-red-400 hover:text-red-300 uppercase tracking-wider cursor-pointer">
                      Desconectar
                    </button>
                  )}
                </div>

                <div className="p-3.5 bg-surface-container-high/40 border border-outline-variant/10 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="block font-label text-[8px] uppercase tracking-widest text-on-surface-variant opacity-60 font-black">Strava Link</span>
                    <span className="font-headline italic font-black text-xs uppercase text-on-surface mt-0.5 block">
                      {stravaConnected ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle size={12} /> ATIVO</span> : <span className="text-on-surface-variant/50">DESCONECTADO</span>}
                    </span>
                  </div>
                  {stravaConnected && (
                    <button type="button" onClick={() => handleDisconnectDevice('strava')} className="text-[10px] font-black text-red-400 hover:text-red-300 uppercase tracking-wider cursor-pointer">
                      Desconectar
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <button 
                  type="button"
                  onClick={handleRequestNativePermissions}
                  disabled={requestingPerms}
                  className="w-full py-3.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 font-headline italic font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <ShieldCheck size={16} />
                  {requestingPerms ? 'Solicitando...' : 'Ativar Permissões do APK (GPS & Saúde)'}
                </button>

                <button 
                  type="button"
                  onClick={() => navigate('/wearables')}
                  className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-black font-headline italic font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-500/10"
                >
                  GERENCIAR WEARABLES COMPLETO
                  <ChevronRight size={14} className="stroke-[3px]" />
                </button>
              </div>
            </div>
          </div>
        );

      case 'biometrics': {
        return (
          <PhysiologicalDiagnostic 
            user={user} 
            metrics={metrics} 
            smartwatchConnected={smartwatchConnected} 
            smartwatchHR={smartwatchHR} 
          />
        );
      }

      case 'scientific_consent':
        return (
          <div className="bg-surface-container-low rounded-[28px] border border-outline-variant/10 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <ShieldCheck size={20} />
              </div>
              <div>
                <h3 className="font-headline italic font-black text-base text-on-surface uppercase leading-none">CONCORDÂNCIA DE DADOS CIENTÍFICOS</h3>
                <p className="font-label text-[7px] text-on-surface-variant uppercase tracking-widest block font-black mt-1">Programa de Pesquisa INVICTUS</p>
              </div>
            </div>
            
            <div className="space-y-3 text-xs text-on-surface-variant leading-relaxed font-sans">
              <p>
                O INVICTUS conduz um <strong>Programa de Estudos em Saúde Física e Performance</strong>. Você pode optar por ceder de forma voluntária e consciente seus logs agregados para estudos científicos.
              </p>
              <div className="p-3 bg-surface-container-high rounded-xl border border-outline-variant/10 space-y-1">
                <p className="text-[10px] font-bold uppercase text-primary tracking-wide">🔒 REGRAS DE ANONIMIZAÇÃO (LGPD)</p>
                <p className="text-[9.5px] leading-relaxed">
                  Todos os dados cedidos para pesquisa científica passam por um processo de <strong>anonimização por Hash Criptográfico</strong>.
                </p>
              </div>
              <div className="p-3 bg-surface-container-high rounded-xl border border-outline-variant/10 space-y-1">
                <p className="text-[10px] font-bold uppercase text-yellow-500 tracking-wide">🔄 DIREITO DE REVOGAÇÃO INCONDICIONAL</p>
                <p className="text-[9.5px] leading-relaxed">
                  Você detém o direito unilateral de revogar seu consentimento a qualquer momento sem penalidade.
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => handleToggleConsent(true)}
                disabled={isUpdatingConsent}
                className={cn(
                  "flex-1 py-3 px-4 rounded-xl font-headline italic font-black text-xs uppercase tracking-wider border-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                  researchConsent === true
                    ? "bg-primary border-primary text-black font-extrabold shadow-lg shadow-primary/15"
                    : "bg-surface-container-high border-outline-variant/10 text-on-surface/50 hover:text-on-surface"
                )}
              >
                {isUpdatingConsent ? <RefreshCw className="animate-spin text-black" size={14} /> : <CheckCircle size={14} />}
                SIM, CONTRIBUIR
              </button>
              
              <button
                type="button"
                onClick={() => handleToggleConsent(false)}
                disabled={isUpdatingConsent}
                className={cn(
                  "flex-1 py-3 px-4 rounded-xl font-headline italic font-black text-xs uppercase tracking-wider border-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                  researchConsent === false
                    ? "bg-surface-container-highest border-outline-variant/40 text-on-surface font-extrabold"
                    : "bg-surface-container-high border-outline-variant/10 text-on-surface/30 hover:text-on-surface"
                )}
              >
                <X size={14} />
                NÃO CONTRIBUIR
              </button>
            </div>
          </div>
        );

      case 'subscription':
        return (
          <div className="space-y-6">
            <div className="bg-surface-container-low rounded-[28px] border border-outline-variant/10 p-5 space-y-5">
              {user.isSubscribed ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary/20 rounded-2xl flex items-center justify-center text-primary">
                      <Crown size={24} className="animate-pulse" />
                    </div>
                    <div>
                      <h3 className="font-headline italic font-black text-xl text-primary uppercase leading-none">INVICTUS PRO ATIVO</h3>
                      <p className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest mt-1">ACESSO ILIMITADO TOTAL LIBERADO</p>
                    </div>
                  </div>
                  <div className="p-4 bg-primary/5 rounded-2xl border border-primary/20">
                    <p className="text-xs text-on-surface/80 leading-relaxed font-semibold">
                      ✓ Sua assinatura está totalmente ativa. Você possui acesso irrestrito a relatórios e inteligência de performance.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-surface-container-high rounded-xl flex items-center justify-center text-on-surface-variant">
                      <Crown size={20} />
                    </div>
                    <div>
                      <h3 className="font-headline italic font-black text-lg text-on-surface uppercase leading-none">PLANO INVICTUS PRO</h3>
                      <p className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest mt-1">DESBLOQUEIE TODO O POTENCIAL</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <button
                      onClick={() => setSelectedPlan('invictus_open')}
                      className={cn(
                        "p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between min-h-[100px] cursor-pointer",
                        selectedPlan === 'invictus_open' 
                          ? "bg-primary/5 border-primary/45 shadow-lg shadow-primary/5" 
                          : "bg-surface-container-high border-outline-variant/10 opacity-70"
                      )}
                    >
                      <div>
                        <span className="font-headline italic font-black text-sm uppercase text-on-surface block">INVICTUS OPEN</span>
                        <span className="text-[9px] text-on-surface-variant font-bold uppercase block">SEM SMARTWATCH OBRIGATÓRIO</span>
                      </div>
                      <p className="text-sm text-primary font-black uppercase pt-2">R$ 9,90 / MÊS</p>
                    </button>

                    <button
                      onClick={() => setSelectedPlan('invictus_performance')}
                      className={cn(
                        "p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between min-h-[100px] cursor-pointer",
                        selectedPlan === 'invictus_performance' 
                          ? "bg-primary/5 border-primary/45 shadow-lg shadow-primary/5" 
                          : "bg-surface-container-high border-outline-variant/10 opacity-70"
                      )}
                    >
                      <div className="absolute top-0 right-0 bg-primary text-black text-[7px] font-black uppercase px-2 py-0.5 rounded-bl-lg font-mono">
                        BIOMETRIA 🏅
                      </div>
                      <div>
                        <span className="font-headline italic font-black text-sm uppercase text-on-surface block">INVICTUS PERFORMANCE</span>
                        <span className="text-[9px] text-on-surface-variant font-bold uppercase block">EXIGE SMARTWATCH COMPATÍVEL</span>
                      </div>
                      <p className="text-sm text-primary font-black uppercase pt-2">R$ 49,90 / MÊS</p>
                    </button>
                  </div>

                  {selectedPlan === 'invictus_performance' && (
                    <div className="p-3.5 bg-yellow-500/5 border border-yellow-500/15 rounded-xl space-y-2">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="hidden" 
                          checked={smartwatchAgreement} 
                          onChange={(e) => setSmartwatchAgreement(e.target.checked)} 
                        />
                        <div className={cn(
                          "w-4 h-4 rounded border transition-all flex items-center justify-center shrink-0 mt-0.5",
                          smartwatchAgreement ? "bg-primary border-primary text-black" : "bg-transparent border-outline-variant/30"
                        )}>
                          {smartwatchAgreement && <Check size={12} className="text-black stroke-[3px]" />}
                        </div>
                        <span className="text-[9.5px] text-on-surface-variant font-medium leading-relaxed font-sans">
                          Concordo que o uso de smartwatch é <strong>OBRIGATÓRIO</strong> para a validação no Plano Performance.
                        </span>
                      </label>
                    </div>
                  )}

                  {checkoutError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-xs">
                      {checkoutError}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <button
                      onClick={() => handleVerifyStorePurchase('android')}
                      disabled={paymentLoading || (selectedPlan === 'invictus_performance' && (!smartwatchConnected || !smartwatchAgreement))}
                      className="bg-emerald-500 text-black font-headline italic font-black text-xs uppercase h-12 rounded-xl transition-all flex items-center justify-center gap-1 shadow-md cursor-pointer disabled:opacity-40"
                    >
                      {paymentLoading ? <RefreshCw className="animate-spin text-black" size={14} /> : <span>🤖 Google Play</span>}
                    </button>

                    <button
                      onClick={() => handleVerifyStorePurchase('ios')}
                      disabled={paymentLoading || (selectedPlan === 'invictus_performance' && (!smartwatchConnected || !smartwatchAgreement))}
                      className="bg-white text-black font-headline italic font-black text-xs uppercase h-12 rounded-xl transition-all flex items-center justify-center gap-1 shadow-md cursor-pointer disabled:opacity-40"
                    >
                      {paymentLoading ? <RefreshCw className="animate-spin text-black" size={14} /> : <span> App Store</span>}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Matrix Table */}
            <div className="bg-surface-container border border-outline-variant/10 p-4 rounded-2xl space-y-3">
              <h4 className="text-xs font-black text-white font-headline italic uppercase">TABELA COMPARATIVA DE RECURSOS</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-[9px] border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[8px] font-black text-on-surface-variant uppercase">
                      <th className="pb-1.5 text-left">RECURSO</th>
                      <th className="pb-1.5 text-center">OPEN</th>
                      <th className="pb-1.5 text-center text-primary">PERFORMANCE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-sans">
                    {[
                      { feat: 'GPS & Anti-Fraude', essen: 'Sim', perf: 'Estrita + Watch' },
                      { feat: 'Smartwatch Nativo', essen: '❌ Não', perf: '✅ Total' },
                      { feat: 'Cardio BPM', essen: '❌ Bloqueado', perf: '✅ Leitura Sensor' },
                      { feat: 'Ligas Premiadas', essen: 'Pública', perf: '🏆 Categoria Elite' },
                    ].map((row, idx) => (
                      <tr key={idx}>
                        <td className="py-2 font-bold text-white uppercase">{row.feat}</td>
                        <td className="py-2 text-center text-on-surface-variant uppercase">{row.essen}</td>
                        <td className="py-2 text-center text-primary uppercase font-black">{row.perf}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );

      case 'performance_scoring':
        return (
          <div className="space-y-6 text-on-surface font-sans">
            <div className="text-center space-y-1">
              <h3 className="font-headline italic font-black text-2xl uppercase tracking-tighter text-on-surface">PONTUAÇÃO JUSTA PERFORMANCE</h3>
              <p className="text-[#EAB308] font-label text-[9px] uppercase tracking-widest font-black">Rankings baseados em esforço e limites biológicos</p>
            </div>
            
            <p className="text-xs text-on-surface-variant font-medium leading-relaxed">
              Avalia você contra os seus limites biológicos reais através de quatro fatores de igual peso (25% cada):
            </p>

            <div className="grid grid-cols-1 gap-3">
              <div className="p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10 space-y-1">
                <div className="text-primary font-headline italic font-black uppercase text-xs">1. FATOR TEMPO (25%)</div>
                <p className="text-[10.5px] text-on-surface-variant leading-relaxed">Duração pontuável capped em 90 minutos para evitar excesso.</p>
              </div>

              <div className="p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10 space-y-1">
                <div className="text-primary font-headline italic font-black uppercase text-xs">2. CARDIOPROTEÇÃO (25%)</div>
                <p className="text-[10.5px] text-on-surface-variant leading-relaxed">Fórmula Tanaka (FCmáx = 208 - 0.7 × idade) com batimentos do smartwatch.</p>
              </div>

              <div className="p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10 space-y-1">
                <div className="text-[#EAB308] font-headline italic font-black uppercase text-xs">3. EFICIÊNCIA (25%)</div>
                <p className="text-[10.5px] text-on-surface-variant leading-relaxed">Calorias gastas divididas pelo peso corporal para igualar atletas.</p>
              </div>

              <div className="p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10 space-y-1">
                <div className="text-[#EAB308] font-headline italic font-black uppercase text-xs">4. CONSISTÊNCIA (25%)</div>
                <p className="text-[10.5px] text-on-surface-variant leading-relaxed">Até 5 dias pontuáveis por semana para desincentivar overtraining.</p>
              </div>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 text-center">
              <p className="font-headline italic font-black text-xs uppercase text-primary">FÓRMULA MATEMÁTICA INTEGRADA</p>
              <p className="font-mono text-xs text-on-surface-variant pt-1 font-bold">
                Pontuação Final = (Tempo + Cardio + Eficiência + Consistência) ÷ 4
              </p>
            </div>
          </div>
        );

      case 'scoring':
      case 'rules':
      case 'transparency':
      case 'about_ai':
      case 'faq':
      case 'usage':
      case 'privacy':
      case 'competition':
      case 'prizes':
        return <ScoringRules section={view} />;

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <header className="px-6 pt-12 pb-6 bg-surface-container-low sticky top-0 z-50 border-b border-outline-variant/10 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-surface-container-high rounded-full transition-colors text-on-surface cursor-pointer">
              <ArrowLeft size={22} />
            </button>
            <div>
              <h1 className="font-headline italic font-black text-2xl uppercase tracking-tighter text-on-surface">CONFIGURAÇÕES</h1>
              <p className="font-label text-[9px] text-on-surface-variant font-bold uppercase tracking-widest">Ajustes da Conta & Conexões</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-md mx-auto py-6 px-4 space-y-6">
        {/* General Feedback Alert System Banner */}
        <AnimatePresence mode="wait">
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={cn(
                "p-4 rounded-2xl flex items-start gap-3 border",
                message.type === 'success' 
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                  : "bg-red-500/10 border-red-500/30 text-red-400"
              )}
            >
              {message.type === 'success' ? <CheckCircle size={18} className="shrink-0 mt-0.5" /> : <AlertCircle size={18} className="shrink-0 mt-0.5" />}
              <div className="flex-1 text-xs font-semibold leading-normal font-sans">
                {message.text}
              </div>
              <button 
                onClick={() => setMessage(null)}
                className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>



        {/* STANDARDIZED CATEGORIES (TAB LIKE STRUCTURE) */}

        {/* 1. CONTA E PERFIL */}
        <section className="space-y-3">
          <h2 className="font-label text-[10px] font-black text-on-surface-variant tracking-widest uppercase px-2">PERFIL E CONTA</h2>
          <div className="bg-surface-container-low rounded-3xl border border-outline-variant/10 overflow-hidden divide-y divide-outline-variant/10">
            <button 
              onClick={() => setActiveSubView('profile_edit')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-on-surface-variant"><User size={18} /></div>
                <div>
                  <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest block">EDITAR PERFIL</span>
                  <span className="text-[9px] text-on-surface-variant">Nome, foto, altura e peso</span>
                </div>
              </div>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>

            <button 
              onClick={() => navigate('/gym')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-primary"><Building2 size={18} /></div>
                <div>
                  <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest block">MINHA ACADEMIA</span>
                  <span className="text-[9px] text-on-surface-variant">Trocar ou cadastrar unidade</span>
                </div>
              </div>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>

            <button 
              onClick={() => navigate('/wallet')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-emerald-400"><CreditCard size={18} /></div>
                <div>
                  <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest block">CARTEIRA & SAQUES PIX</span>
                  <span className="text-[9px] text-on-surface-variant">Saldo em Reais (R$) e extrato</span>
                </div>
              </div>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>
          </div>
        </section>

        {/* 2. SAÚDE, SENSOTECNOLOGIA & WEARABLES */}
        <section className="space-y-3">
          <h2 className="font-label text-[10px] font-black text-on-surface-variant tracking-widest uppercase px-2">SAÚDE & WEARABLES</h2>
          <div className="bg-surface-container-low rounded-3xl border border-outline-variant/10 overflow-hidden divide-y divide-outline-variant/10">
            <button 
              onClick={() => setActiveSubView('wearables')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-amber-400"><Watch size={18} /></div>
                <div>
                  <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest block">SMARTWATCH & SENSORES</span>
                  <span className="text-[9px] text-on-surface-variant">Apple Health, Health Connect & Strava</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {smartwatchConnected ? (
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[8px] font-black px-2 py-0.5 rounded-full uppercase">CONECTADO</span>
                ) : (
                  <span className="bg-white/5 text-on-surface-variant text-[8px] font-black px-2 py-0.5 rounded-full uppercase">DESCONECTADO</span>
                )}
                <ChevronRight size={18} className="text-on-surface-variant/50" />
              </div>
            </button>

            <button 
              onClick={() => setActiveSubView('biometrics')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-blue-400"><Activity size={18} /></div>
                <div>
                  <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest block">DIAGNÓSTICO FISIOLÓGICO</span>
                  <span className="text-[9px] text-on-surface-variant">Score biológico, cardio e calorias</span>
                </div>
              </div>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>

            <button 
              onClick={() => setActiveSubView('scientific_consent')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-primary"><ShieldCheck size={18} /></div>
                <div>
                  <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest block">CESSÃO CIENTÍFICA (LGPD)</span>
                  <span className="text-[9px] text-on-surface-variant">Programa de pesquisa em saúde</span>
                </div>
              </div>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>
          </div>
        </section>

        {/* 3. PLANO E ASSINATURA */}
        <section className="space-y-3">
          <h2 className="font-label text-[10px] font-black text-on-surface-variant tracking-widest uppercase px-2">PLANO & ASSINATURA</h2>
          <div className="bg-surface-container-low rounded-3xl border border-outline-variant/10 overflow-hidden">
            <button 
              onClick={() => setActiveSubView('subscription')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-amber-400"><Crown size={18} /></div>
                <div>
                  <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest block">ASSINATURA INVICTUS PRO</span>
                  <span className="text-[9px] text-on-surface-variant">
                    {user.isSubscribed ? 'Plano Ativo' : 'Fazer Upgrade para Performance'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {user.isSubscribed ? (
                  <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[8px] font-black px-2.5 py-0.5 rounded-full uppercase">PRO ATIVO</span>
                ) : (
                  <span className="bg-primary/10 text-primary border border-primary/20 text-[8px] font-black px-2.5 py-0.5 rounded-full uppercase">UPGRADE</span>
                )}
                <ChevronRight size={18} className="text-on-surface-variant/50" />
              </div>
            </button>
          </div>
        </section>

        {/* 4. PREFERÊNCIAS DO APP */}
        <section className="space-y-3">
          <h2 className="font-label text-[10px] font-black text-on-surface-variant tracking-widest uppercase px-2">PREFERÊNCIAS DO APLICATIVO</h2>
          <div className="bg-surface-container-low rounded-3xl border border-outline-variant/10 overflow-hidden divide-y divide-outline-variant/10">
            <div className="p-4 flex items-center justify-between h-14">
              <div className="flex items-center gap-3">
                <div className="text-on-surface-variant">
                  {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
                </div>
                <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest">MODO ESCURO</span>
              </div>
              <button 
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={cn(
                  "w-10 h-5 rounded-full transition-all relative cursor-pointer",
                  theme === 'dark' ? "bg-primary" : "bg-surface-container-highest"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                  theme === 'dark' ? "left-5.5" : "left-0.5"
                )} />
              </button>
            </div>

            <div className="p-4 flex items-center justify-between h-14">
              <div className="flex items-center gap-3">
                <div className="text-on-surface-variant"><Bell size={18} /></div>
                <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest">ALERTAS WHATSAPP</span>
              </div>
              <button 
                onClick={() => setWhatsappEnabled(!whatsappEnabled)}
                className={cn(
                  "w-10 h-5 rounded-full transition-all relative cursor-pointer",
                  whatsappEnabled ? "bg-primary" : "bg-surface-container-highest"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                  whatsappEnabled ? "left-5.5" : "left-0.5"
                )} />
              </button>
            </div>
          </div>
        </section>

        {/* 5. ENTENDA O JOGO */}
        <section className="space-y-3">
          <h2 className="font-label text-[10px] font-black text-on-surface-variant tracking-widest uppercase px-2">ENTENDA O JOGO</h2>
          <div className="bg-surface-container-low rounded-3xl border border-outline-variant/10 overflow-hidden divide-y divide-outline-variant/10">
            <button 
              onClick={() => setActiveSubView('scoring')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-on-surface-variant"><TrendingUp size={18} /></div>
                <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest">COMO FUNCIONA A PONTUAÇÃO</span>
              </div>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>

            <button 
              onClick={() => setActiveSubView('rules')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-on-surface-variant"><Calendar size={18} /></div>
                <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest">REGRAS DA TEMPORADA</span>
              </div>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>

            <button 
              onClick={() => setActiveSubView('transparency')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-on-surface-variant"><ShieldCheck size={18} /></div>
                <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest">TRANSPARÊNCIA E VALIDAÇÃO</span>
              </div>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>

            <button 
              onClick={() => setActiveSubView('about_ai')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left bg-emerald-500/5 hover:bg-emerald-500/10 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-emerald-400"><Sparkles size={18} /></div>
                <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest flex items-center gap-1.5">
                  SOBRE A INVICTUS IA
                  <span className="bg-emerald-500/10 text-emerald-400 text-[6.5px] font-black px-1 py-0.5 rounded uppercase font-mono tracking-widest">Segurança & IA</span>
                </span>
              </div>
              <ChevronRight size={18} className="text-emerald-400/60" />
            </button>

            <button 
              onClick={() => setActiveSubView('faq')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-on-surface-variant"><Info size={18} /></div>
                <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest">PERGUNTAS FREQUENTES (FAQ)</span>
              </div>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>

            <button 
              onClick={() => setActiveSubView('performance_scoring')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left bg-yellow-500/5 hover:bg-yellow-500/10 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="text-[#EAB308]"><Crown size={18} /></div>
                <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest flex items-center gap-1.5">
                  FÓRMULA JUSTA PERFORMANCE
                  <span className="bg-yellow-500/10 text-yellow-500 text-[6.5px] font-black px-1 py-0.5 rounded uppercase font-mono tracking-widest">Premium</span>
                </span>
              </div>
              <ChevronRight size={18} className="text-[#EAB308]/60" />
            </button>
          </div>
        </section>

        {/* 6. TERMOS E POLÍTICAS */}
        <section className="space-y-3">
          <h2 className="font-label text-[10px] font-black text-on-surface-variant tracking-widest uppercase px-2">TERMOS E POLÍTICAS</h2>
          <div className="bg-surface-container-low rounded-3xl border border-outline-variant/10 overflow-hidden divide-y divide-outline-variant/10">
            <button 
              onClick={() => setActiveSubView('usage')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest ml-1">TERMOS DE USO</span>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>

            <button 
              onClick={() => setActiveSubView('privacy')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest ml-1">POLÍTICA DE PRIVACIDADE</span>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>

            <button 
              onClick={() => setActiveSubView('competition')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest ml-1">REGRAS DA COMPETIÇÃO</span>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>

            <button 
              onClick={() => setActiveSubView('prizes')}
              className="w-full p-4 flex items-center justify-between h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest ml-1">POLÍTICA DE PREMIAÇÃO</span>
              <ChevronRight size={18} className="text-on-surface-variant/50" />
            </button>
          </div>
        </section>

        {/* 7. SESSÃO E CONTA */}
        <section className="space-y-3">
          <h2 className="font-label text-[10px] font-black text-on-surface-variant tracking-widest uppercase px-2">SESSÃO DA CONTA</h2>
          <div className="bg-surface-container-low rounded-3xl border border-outline-variant/10 overflow-hidden divide-y divide-outline-variant/10">
            <button 
              onClick={handleLogout}
              className="w-full p-4 flex items-center gap-3 h-14 hover:bg-surface-container-high transition-colors text-left cursor-pointer"
            >
              <LogOut size={18} className="text-on-surface-variant" />
              <span className="font-label text-xs font-bold text-on-surface uppercase tracking-widest">ENCERRAR SESSÃO</span>
            </button>

            <button 
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full p-4 flex items-center gap-3 h-14 hover:bg-error/5 transition-colors text-left cursor-pointer"
            >
              <AlertTriangle size={18} className="text-error" />
              <span className="font-label text-xs font-bold text-error uppercase tracking-widest">EXCLUIR CONTA</span>
            </button>
          </div>
        </section>

        {/* 8. PAINEL ADMIN (APENAS ADMINS) */}
        {user.role === 'admin' && (
          <section className="space-y-3">
            <h2 className="font-label text-[10px] font-black text-primary tracking-widest uppercase px-2">ADMINISTRAÇÃO</h2>
            <div className="bg-primary/5 rounded-3xl border border-primary/20 overflow-hidden">
              <button 
                onClick={() => navigate('/admin')}
                className="w-full p-5 flex items-center justify-between hover:bg-primary/10 transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center text-primary">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <p className="font-headline italic font-black text-lg text-on-surface uppercase leading-none">PAINEL ADMIN</p>
                    <p className="font-label text-[9px] text-primary uppercase tracking-widest mt-0.5">Gerenciar Usuários e Treinos</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-primary" />
              </button>
            </div>
          </section>
        )}

        <div className="text-center space-y-1 pt-6 opacity-40">
          <p className="font-label text-[8px] font-black uppercase tracking-[0.4em]">INVICTUS V.2.4.0</p>
          <p className="font-label text-[8px] font-black uppercase tracking-[0.3em]">© 2026 INVICTUS PERFORMANCE E SOLUÇÕES LTDA</p>
          <p className="font-label text-[7px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">CNPJ 67.770.822/0001-22 • PORTO ALEGRE - RS</p>
        </div>
      </div>

      {/* STANDARDIZED SUB-VIEW OVERLAY FOR ALL FUNCTIONS */}
      <AnimatePresence>
        {activeSubView && (
          <div className="fixed inset-0 z-[110] bg-background">
            <header className="px-6 pt-12 pb-6 border-b border-outline-variant/10 flex items-center gap-4 bg-surface-container-low sticky top-0 z-50">
              <button 
                onClick={() => setActiveSubView(null)} 
                className="p-2 hover:bg-surface-container-high rounded-full transition-colors text-on-surface cursor-pointer"
              >
                <ArrowLeft size={22} />
              </button>
              <div>
                <h2 className="font-headline italic font-black text-xl uppercase tracking-tighter text-on-surface leading-none">
                  {getSubViewHeader(activeSubView).title}
                </h2>
                <p className="font-label text-[9px] text-on-surface-variant font-bold uppercase tracking-widest mt-0.5">
                  {getSubViewHeader(activeSubView).subtitle}
                </p>
              </div>
            </header>
            
            <div className="h-[calc(100vh-100px)] overflow-y-auto px-4 py-6 max-w-md mx-auto space-y-6">
              {renderSubViewContent(activeSubView)}
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowDeleteConfirm(false)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md bg-surface-container rounded-[40px] overflow-hidden shadow-2xl p-8 text-center space-y-6"
            >
              <div className="w-20 h-20 bg-error/10 text-error rounded-3xl flex items-center justify-center mx-auto shadow-lg">
                <AlertTriangle size={40} />
              </div>
              <div className="space-y-3">
                <h3 className="font-headline italic font-black text-3xl uppercase tracking-tighter text-on-surface">TEM CERTEZA?</h3>
                <p className="font-label text-xs font-black text-on-surface-variant uppercase tracking-widest leading-relaxed">
                  ESTA AÇÃO É IRREVERSÍVEL. VOCÊ PERDERÁ TODO SEU PROGRESSO, XP E SALDO EM CARTEIRA.
                </p>
              </div>
              <div className="space-y-3">
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="w-full h-14 bg-surface-container-highest text-on-surface font-headline italic font-black text-lg rounded-2xl hover:bg-surface-container-high transition-all cursor-pointer"
                >
                  CANCELAR
                </button>
                <button 
                  onClick={() => {
                    alert('Para excluir sua conta, entre em contato com o suporte via WhatsApp.');
                    setShowDeleteConfirm(false);
                  }}
                  className="w-full h-14 bg-error text-on-error font-headline italic font-black text-lg rounded-2xl hover:bg-error-dim transition-all shadow-lg shadow-error/20 cursor-pointer"
                >
                  EXCLUIR TUDO
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Status Overlay */}
      <AnimatePresence>
        {paymentStatusOverlay && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
              onClick={() => setPaymentStatusOverlay(null)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-surface-container rounded-[40px] overflow-hidden shadow-2xl p-8 text-center space-y-6 border border-outline-variant/10"
            >
              {(paymentStatusOverlay === 'success' || paymentStatusOverlay === 'approved') ? (
                <>
                  <div className="relative">
                    <div className="absolute -top-6 -left-6 text-yellow-500 animate-[pulse_1.5s_infinite] shrink-0">
                      <Sparkles size={24} fill="currentColor" />
                    </div>
                    <div className="absolute -top-4 -right-4 text-primary animate-[pulse_2s_infinite] shrink-0">
                      <Crown size={20} className="rotate-12" fill="currentColor" />
                    </div>
                    
                    <div className="w-20 h-20 bg-gradient-to-tr from-amber-500 via-primary to-orange-600 text-white rounded-[28px] flex items-center justify-center mx-auto shadow-lg shadow-primary/20 animate-bounce">
                      <Crown size={38} className="text-white fill-white/20" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="text-[9px] font-black tracking-[0.2em] text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 px-3 py-1 rounded-full uppercase leading-none font-mono">ASSINATURA PREMIUM ATIVA</span>
                    <h3 className="font-headline italic font-black text-2xl uppercase tracking-tight text-white leading-none mt-2">
                      BEM-VINDO AO <br/>
                      <span className="bg-gradient-to-r from-amber-400 via-primary to-orange-500 bg-clip-text text-transparent">INVICTUS PERFORMANCE</span>
                    </h3>
                  </div>

                  <div className="pt-2">
                    <button 
                      onClick={() => {
                        setPaymentStatusOverlay(null);
                        window.location.reload();
                      }}
                      className="w-full h-14 bg-gradient-to-r from-amber-500 via-primary to-orange-600 text-white font-headline italic font-black text-sm rounded-xl active:scale-95 transition-all uppercase tracking-wider cursor-pointer shadow-lg"
                    >
                      ATIVAR MÁXIMO RENDIMENTO ⚡
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 bg-error/10 text-error rounded-[28px] flex items-center justify-center mx-auto shadow-lg">
                    <AlertTriangle size={36} className="text-error" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-headline italic font-black text-2xl uppercase tracking-tighter text-error">OPS, ALGO FALHOU</h3>
                    <p className="font-label text-xs font-bold text-on-surface-variant uppercase tracking-wide leading-relaxed px-2">
                      {paymentStatusMessage || 'Não foi possível aprovar o pagamento. Tente novamente.'}
                    </p>
                  </div>
                  <div className="pt-2">
                    <button 
                      onClick={() => setPaymentStatusOverlay(null)}
                      className="w-full h-14 bg-error text-on-error font-headline italic font-black text-sm rounded-xl active:scale-95 transition-all uppercase tracking-wider cursor-pointer"
                    >
                      TENTAR NOVAMENTE
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Disconnect Confirm Modal */}
      {showDisconnectConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[130] flex items-center justify-center p-4">
          <div className="bg-surface-container border border-white/10 rounded-2xl p-6 w-full max-w-sm text-center space-y-4 shadow-2xl text-on-surface">
            <div className="mx-auto w-12 h-12 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center">
              <AlertTriangle size={24} />
            </div>
            
            <div className="space-y-2">
              <h3 className="font-headline font-black text-lg text-white">
                Desconectar {showDisconnectConfirm === 'apple_health' ? 'Apple HealthKit' : showDisconnectConfirm === 'health_connect' ? 'Android Health Connect' : 'Strava'}?
              </h3>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Tem certeza que deseja desconectar o dispositivo? Novos treinos gravados nele não serão computados automaticamente.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => executeDisconnectDevice(showDisconnectConfirm)}
                className="w-full bg-red-500 hover:bg-red-600 text-white font-black py-2.5 rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer"
              >
                Sim, Desconectar
              </button>
              <button
                onClick={() => setShowDisconnectConfirm(null)}
                className="w-full bg-surface-container-highest hover:bg-white/5 text-on-surface font-semibold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
