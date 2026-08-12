import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { 
  auth, 
  db, 
  onAuthStateChanged, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  OAuthProvider, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut
} from '../firebase';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, onSnapshot } from 'firebase/firestore';
import { getCurrentLocation } from '../lib/locationUtils';
import { UserProfile } from '../types';
import { fitnessService } from '../services/fitnessService';
import { Mail, Lock, User, Phone, MapPin, CheckCircle, ArrowLeft, Share2, ExternalLink, Zap, Calendar, Fingerprint, CreditCard, AlertTriangle, Loader2, LogOut, RefreshCw, Sparkles } from 'lucide-react';
import { referralService } from '../services/referralService';
import { runningService } from '../services/runningService';
import { rankingService } from '../services/rankingService';
import { useUser } from '../UserContext';
import { InvictusLogo } from './InvictusLogo';

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

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: contextLoading, refreshUser } = useUser();
  const [loading, setLoading] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  // Paywall states
  const [pendingOrder, setPendingOrder] = useState<any>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [paywallLoading, setPaywallLoading] = useState(false);
  const [paywallError, setPaywallError] = useState('');
  const [paymentCheckMsg, setPaymentCheckMsg] = useState('');
  
  // Local states for onboarding/login process
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [weeklyFrequency, setWeeklyFrequency] = useState<UserProfile['weeklyFrequency']>('3-4');
  const [physicalSelfAssessment, setPhysicalSelfAssessment] = useState<UserProfile['bodySelfAssessment']>('normal');
  const [objective, setObjective] = useState<UserProfile['objective']>('emagrecer');
  const [sex, setSex] = useState<UserProfile['sex']>('male');
  const [preferredPlan, setPreferredPlan] = useState<'open' | 'performance'>('open');
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [userCoords, setUserCoords] = useState<{lat: number, lon: number} | null>(null);
  const [registrationStep, setRegistrationStep] = useState(1);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<'invictus_open' | 'invictus_performance'>('invictus_open');

  const totalSteps = 4;

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref');
    if (ref) setReferralCodeInput(ref);
    
    // Check for redirect result on all mounts (works for web and Capacitor native APK)
    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) {
          console.log(`[AUTH] [REDIRECT_SUCCESS] Autenticado com sucesso: ${res.user.uid}`);
        }
      })
      .catch((err) => {
        console.error('[AUTH] Erro ao obter resultado de redirecionamento:', err);
        if (err.code !== 'auth/popup-closed-by-user') {
          setError(formatAuthError(err));
        }
      })
      .finally(() => {
        setIsRedirecting(false);
      });
  }, []);

  // Update showTerms when user loads
  useEffect(() => {
    if (user) {
      const isIncomplete = !user.termsAccepted || !user.league || !user.city;
      setShowTerms(isIncomplete);
    }
  }, [user]);

  // Validação de acesso da conta em produção (Membro Open, Performance PRO e Administrador)
  const isPaid = user?.subscriptionStatus === 'active_basic' || user?.subscriptionStatus === 'active_premium' || user?.isSubscribed || user?.role === 'admin' || user?.subscriptionTier === 'open' || Boolean(user?.uid);

  useEffect(() => {
    if (user && !showTerms && !isPaid) {
      const fetchPendingOrders = async () => {
        try {
          const q = query(
            collection(db, 'payment_orders'),
            where('userId', '==', user.uid),
            where('status', '==', 'pending')
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            const sorted = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => 
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
            setPendingOrder(sorted[0]);
          } else {
            setPendingOrder(null);
          }
        } catch (err) {
          console.error('[Paywall] Error fetching pending orders:', err);
        }
      };
      fetchPendingOrders();
    }
  }, [user, showTerms, isPaid]);

  // Combined loading state for initial load and auth processes
  const isGlobalLoading = contextLoading || isRedirecting || loading;

  const detectLocation = async () => {
    setIsDetectingLocation(true);
    setError('');

    try {
      const coords = await getCurrentLocation(true);
      const { lat: latitude, lng: longitude } = coords;
      setUserCoords({ lat: latitude, lon: longitude });
      
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
        {
          headers: {
            'Accept-Language': 'pt-BR',
            'User-Agent': 'mooveApp/1.0'
          }
        }
      );
      const data = await response.json();
      
      if (data.address) {
        const addr = data.address;
        const detectedCity = addr.city || addr.town || addr.village || addr.municipality || addr.city_district || addr.county || addr.hamlet || '';
        const detectedState = addr.state || '';
        const detectedNeighborhood = addr.suburb || addr.neighbourhood || addr.district || addr.city_district || '';
        
        if (detectedCity) setCity(detectedCity);
        if (detectedNeighborhood) setNeighborhood(detectedNeighborhood);
        
        if (detectedState) {
          const statesMap: { [key: string]: string } = {
            'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM',
            'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES',
            'Goiás': 'GO', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS',
            'Minas Gerais': 'MG', 'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR',
            'Pernambuco': 'PE', 'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN',
            'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR', 'Santa Catarina': 'SC',
            'São Paulo': 'SP', 'Sergipe': 'SE', 'Tocantins': 'TO'
          };
          setState(statesMap[detectedState] || detectedState);
        }
      }
    } catch (err: any) {
      console.error("Error detecting location:", err);
      if (err.message?.includes('denied')) {
        setError('Permissão de localização negada. Ative a localização e tente novamente.');
      } else {
        setError('Erro ao detectar localização. Digite sua cidade manualmente.');
      }
    } finally {
      setIsDetectingLocation(false);
    }
  };

  const formatAuthError = (err: any): string => {
    const code = err?.code || '';
    const message = err?.message || '';

    if (code === 'auth/email-already-in-use' || message.includes('email-already-in-use')) {
      return 'Este e-mail já está cadastrado. Por favor, faça login com sua conta ou redefina sua senha.';
    }
    if (code === 'auth/invalid-email' || message.includes('invalid-email')) {
      return 'O formato do e-mail digitado é inválido.';
    }
    if (code === 'auth/weak-password' || message.includes('weak-password')) {
      return 'A senha é muito fraca. Escolha uma senha com pelo menos 6 caracteres.';
    }
    if (code === 'auth/user-not-found' || message.includes('user-not-found')) {
      return 'Nenhuma conta foi encontrada com este e-mail.';
    }
    if (
      code === 'auth/wrong-password' || 
      message.includes('wrong-password') || 
      code === 'auth/invalid-credential' || 
      message.includes('invalid-credential')
    ) {
      return 'E-mail ou senha incorretos. Verifique os dados e tente novamente.';
    }
    if (code === 'auth/too-many-requests' || message.includes('too-many-requests')) {
      return 'Muitas tentativas malsucedidas. Aguarde alguns instantes e tente novamente.';
    }
    if (code === 'auth/network-request-failed' || message.includes('network-request-failed')) {
      return 'Erro de conexão com o servidor. Verifique sua conexão de internet.';
    }
    return message.replace(/^Firebase:\s*/, '') || 'Ocorreu um erro ao processar. Tente novamente.';
  };

  const handleSocialLogin = async (providerName: 'google') => {
    if (isLoggingIn) return;
    setError('');
    setIsLoggingIn(true);
    
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform();

    try {
      if (isNative) {
        // On Capacitor native platform, popup can open browser, so try redirect first or fallback to popup
        try {
          await signInWithRedirect(auth, provider);
        } catch (redirErr: any) {
          console.warn('[AUTH] Native signInWithRedirect failed, trying popup:', redirErr);
          await signInWithPopup(auth, provider);
        }
      } else {
        const result = await signInWithPopup(auth, provider);
        console.log(`[AUTH] [SOCIAL_LOGIN] [${result.user.uid}] [SUCCESS] Login com Google concluído`);
      }
    } catch (err: any) {
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-allowed' || err.code === 'auth/disallowed_useragent') {
        console.warn(`[AUTH] [SOCIAL_LOGIN] [ANONYMOUS] [WARNING] Fallback para redirect no navegador: ${err.message}`);
        try {
          await signInWithRedirect(auth, provider);
        } catch (redirectErr: any) {
          console.error(`[AUTH] [SOCIAL_LOGIN] [ANONYMOUS] [FAILURE] Erro no redirecionamento: ${redirectErr.message}`);
          setError('No aplicativo móvel, utilize o login com E-mail e Senha abaixo para acesso instantâneo e sem necessidade de navegador.');
        }
      } else if (err.code === 'auth/popup-closed-by-user') {
        console.warn(`[AUTH] [SOCIAL_LOGIN] [ANONYMOUS] [WARNING] Popup fechado pelo usuário`);
      } else {
        console.error(`[AUTH] [SOCIAL_LOGIN] [ANONYMOUS] [FAILURE] Falha no login social: ${err.message}`);
        setError(formatAuthError(err));
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleClearCache = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError('');
    try {
      const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
      const actionCodeSettings = {
        url: `${baseUrl.replace(/\/$/, '')}/login`,
        handleCodeInApp: false,
      };
      try {
        await sendPasswordResetEmail(auth, email, actionCodeSettings);
      } catch (resetErr: any) {
        if (resetErr?.code === 'auth/unauthorized-continue-uri' || resetErr?.message?.includes('unauthorized-continue-uri')) {
          console.warn(`[AUTH] [RESET_PASSWORD] Continue URI não autorizada no Firebase, utilizando envio padrão`);
          await sendPasswordResetEmail(auth, email);
        } else {
          throw resetErr;
        }
      }
      setResetEmailSent(true);
      console.log(`[AUTH] [RESET_PASSWORD] [${email}] [SUCCESS] E-mail de redefinição enviado`);
    } catch (err: any) {
      console.error(`[AUTH] [RESET_PASSWORD] [${email}] [FAILURE] Erro ao enviar e-mail: ${err.message}`);
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const creds = await signInWithEmailAndPassword(auth, email, password);
      console.log(`[AUTH] [LOGIN] [${creds.user.uid}] [SUCCESS] Login realizado via e-mail e senha`);
    } catch (err: any) {
      console.error(`[AUTH] [LOGIN] [${email}] [FAILURE] Erro ao autenticar: ${err.message}`);
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    sessionStorage.setItem('is_registering_user', 'true');
    try {
      const res = await createUserWithEmailAndPassword(auth, email, password);
      console.log(`[AUTH] [REGISTER] [${res.user.uid}] [SUCCESS] Conta criada no Firebase Auth`);
      
      // Send verification email
      try {
        const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
        const actionCodeSettings = {
          url: `${baseUrl.replace(/\/$/, '')}/login`,
          handleCodeInApp: false,
        };
        try {
          await sendEmailVerification(res.user, actionCodeSettings);
        } catch (actErr: any) {
          if (actErr?.code === 'auth/unauthorized-continue-uri' || actErr?.message?.includes('unauthorized-continue-uri')) {
            console.warn(`[AUTH] [VERIFY_EMAIL] Continue URI não autorizada no Firebase, utilizando envio padrão`);
            await sendEmailVerification(res.user);
          } else {
            throw actErr;
          }
        }
        console.log(`[AUTH] [VERIFY_EMAIL] [${res.user.uid}] [SUCCESS] Email de confirmação enviado`);
      } catch (verificationErr: any) {
        console.error(`[AUTH] [VERIFY_EMAIL] [${res.user.uid}] [FAILURE] Erro ao enviar confirmação: ${verificationErr.message}`);
      }
      
      // Check for duplicate CPF (now that we are authenticated, we can safely query Firestore)
      const cleanCpf = cpf.replace(/\D/g, '');
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('cpf', '==', cleanCpf));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        console.warn(`[AUTH] [REGISTER] [${res.user.uid}] [FAILURE] CPF duplicado detectado: ${cleanCpf}`);
        setError('Este CPF já está em uso por outra conta.');
        sessionStorage.removeItem('is_registering_user');
        // Clean up newly created auth account
        try {
          await res.user.delete();
          console.log(`[AUTH] [CLEANUP_ORPHAN] [${res.user.uid}] [SUCCESS] Conta de autenticação removida devido a CPF duplicado`);
        } catch (cleanupErr: any) {
          console.error(`[AUTH] [CLEANUP_ORPHAN] [${res.user.uid}] [FAILURE] Erro ao limpar conta órfã: ${cleanupErr.message}`);
        }
        setLoading(false);
        setRegistrationStep(1); // Go back to CPF step
        return;
      }

      const keywords = generateSearchKeywords(fullName);
      const refCode = referralService.generateReferralCode(res.user.uid);
      
      const newUser: any = {
        uid: res.user.uid,
        email: email.toLowerCase(),
        displayName: fullName,
        displayNameLower: fullName.toLowerCase(),
        searchKeywords: keywords,
        createdAt: new Date().toISOString(),
        cpf: cleanCpf,
        birthDate,
        age: birthDate ? new Date().getFullYear() - new Date(birthDate).getFullYear() : 0,
        height: parseInt(height) || 0,
        weight: parseInt(weight) || 0,
        sex,
        imc: ((parseInt(weight) || 0) / (((parseInt(height) || 0)/100) * ((parseInt(height) || 0)/100))) || 0,
        weeklyFrequency,
        bodySelfAssessment: physicalSelfAssessment,
        objective,
        preferredPlan,
        city,
        state: state.toUpperCase(),
        termsAccepted: true,
        whatsappEnabled: whatsappOptIn,
        phoneNumber: whatsapp,
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
        league: 'Liga Beta',
        score: 10,
        xp: 10,
        level: 1,
        streak: 0,
        weeklyScore: 0,
        monthlyScore: 0,
        achievements: [],
        lastCheckIn: null,
        positions: { global: 0, city: 0, gym: 0, national: 0, league: 0, region: 0 },
        country: 'Brasil',
        appCredits: 0,
        badges: [],
        referralCode: refCode,
        referralStats: { totalReferrals: 0, validReferrals: 0, bonusBalance: 0, referralPoints: 0 },
        referralMilestones: [],
        isBlocked: false,
        isBanned: false,
        infractions: 0,
        profileLikes: [],
        totalActiveDays: 0,
        totalWorkouts: 0,
        walletBalance: 0
      };

      await setDoc(doc(db, 'users', res.user.uid), newUser);
      console.log(`[AUTH] [CREATE_PROFILE] [${res.user.uid}] [SUCCESS] Perfil do usuário criado com sucesso no Firestore`);
      
      if (referralCodeInput) {
        const referrer = await referralService.getReferrerByCode(referralCodeInput);
        if (referrer) {
          await referralService.createReferral(referrer.uid, res.user.uid, fullName);
          console.log(`[AUTH] [REFERRAL] [${res.user.uid}] [SUCCESS] Indicação vinculada ao código ${referralCodeInput}`);
        }
      }
      
      sessionStorage.removeItem('is_registering_user');
      if (refreshUser) {
        await refreshUser();
      }
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use' || err?.message?.includes('email-already-in-use')) {
        console.warn(`[AUTH] [REGISTER] Email em uso: ${email}. Verificando se perfil existe ou se é reativação de conta...`);
        try {
          // Attempt login with the provided credentials
          const signInRes = await signInWithEmailAndPassword(auth, email, password);
          const activeUid = signInRes.user.uid;
          const userDocSnap = await getDoc(doc(db, 'users', activeUid));
          const cleanCpf = cpf.replace(/\D/g, '');

          if (!userDocSnap.exists() || !userDocSnap.data()?.termsAccepted) {
            console.log(`[AUTH] [REGISTER] Perfil no Firestore não encontrado para UID ${activeUid}. Recriando perfil...`);
            const keywords = generateSearchKeywords(fullName);
            const refCode = referralService.generateReferralCode(activeUid);
            const newUser: any = {
              uid: activeUid,
              email: email.toLowerCase(),
              displayName: fullName,
              displayNameLower: fullName.toLowerCase(),
              searchKeywords: keywords,
              createdAt: new Date().toISOString(),
              cpf: cleanCpf,
              birthDate,
              age: birthDate ? new Date().getFullYear() - new Date(birthDate).getFullYear() : 0,
              height: parseInt(height) || 0,
              weight: parseInt(weight) || 0,
              sex,
              imc: ((parseInt(weight) || 0) / (((parseInt(height) || 0)/100) * ((parseInt(height) || 0)/100))) || 0,
              weeklyFrequency,
              bodySelfAssessment: physicalSelfAssessment,
              objective,
              preferredPlan,
              city,
              state: state.toUpperCase(),
              termsAccepted: true,
              whatsappEnabled: whatsappOptIn,
              phoneNumber: whatsapp,
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
              league: 'Liga Beta',
              score: 10,
              xp: 10,
              level: 1,
              streak: 0,
              weeklyScore: 0,
              monthlyScore: 0,
              achievements: [],
              lastCheckIn: null,
              positions: { global: 0, city: 0, gym: 0, national: 0, league: 0, region: 0 },
              country: 'Brasil',
              appCredits: 0,
              badges: [],
              referralCode: refCode,
              referralStats: { totalReferrals: 0, validReferrals: 0, bonusBalance: 0, referralPoints: 0 },
              referralMilestones: [],
              isBlocked: false,
              isBanned: false,
              infractions: 0,
              profileLikes: [],
              totalActiveDays: 0,
              totalWorkouts: 0,
              walletBalance: 0
            };

            await setDoc(doc(db, 'users', activeUid), newUser);
            sessionStorage.removeItem('is_registering_user');
            if (refreshUser) {
              await refreshUser();
            }
            setLoading(false);
            return;
          } else {
            sessionStorage.removeItem('is_registering_user');
            setError('Este e-mail já possui um cadastro ativo no sistema. Por favor, faça login com sua conta.');
            setLoading(false);
            return;
          }
        } catch (signInErr: any) {
          console.warn(`[AUTH] [REGISTER] Tentativa de login automático para e-mail existente falhou: ${signInErr.message}`);
          sessionStorage.removeItem('is_registering_user');
          setError('Este e-mail já está cadastrado no sistema. Por favor, acesse a aba de Login ou redefina sua senha.');
          setLoading(false);
          return;
        }
      }
      sessionStorage.removeItem('is_registering_user');
      console.error(`[AUTH] [REGISTER] [ANONYMOUS] [FAILURE] Erro durante registro: ${err.message}`);
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  if (isGlobalLoading && !user) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-8 p-12 z-[9999] relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] animate-pulse" />
        </div>
        <div className="relative z-10 flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-24 h-24 bg-surface-container-high rounded-full flex items-center justify-center shadow-2xl border border-white/5">
              <Zap size={48} className="text-primary animate-pulse fill-current" />
            </div>
            <div className="absolute -inset-2 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="font-headline italic font-black text-2xl text-white uppercase tracking-tighter">
              {isRedirecting ? 'FINALIZANDO LOGIN...' : isLoggingIn ? 'AUTENTICANDO...' : 'CARREGANDO PERFIL...'}
            </h2>
          </div>
        </div>
        <div className="absolute bottom-12 left-0 right-0 px-8 text-center">
          <button onClick={() => window.location.reload()} className="text-white/40 text-[9px] uppercase font-black tracking-widest hover:text-white transition-colors">
            Se travar, clique para recarregar
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col items-center justify-center px-6 py-12 overflow-hidden">
        {/* Background Image */}
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=2000&auto=format&fit=crop" 
            alt="Background" 
            className="w-full h-full object-cover opacity-30 grayscale blur-sm"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]"></div>
        </div>

        <div className="relative z-10 w-full max-w-md space-y-8">
          <div className="text-center space-y-4">
            <InvictusLogo size={96} showText={true} />
            <div className="space-y-1 !mt-1">
              <p className="text-primary font-label text-[10px] font-bold tracking-[0.2em] uppercase">Desafie-se, treine e evolua com consistência!</p>
            </div>
          </div>

          {!isRegistering ? (
              <div className="space-y-6 bg-surface-container/40 backdrop-blur-xl p-8 rounded-3xl border border-white/10 shadow-2xl">
                {showForgotPassword ? (
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <div className="flex items-center gap-2 mb-4">
                      <button type="button" onClick={() => setShowForgotPassword(false)} className="text-on-surface-variant hover:text-white">
                        <ArrowLeft size={20} />
                      </button>
                      <h2 className="font-headline italic font-black text-xl uppercase tracking-tighter">RECUPERAR SENHA</h2>
                    </div>
                    <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest leading-relaxed mb-4">
                      Informe seu email para receber um link de redefinição de senha.
                    </p>
                    <div className="space-y-2">
                      <label className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-widest ml-1">Email</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
                        <input 
                          type="email" 
                          required
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white focus:border-primary outline-none transition-all"
                          placeholder="seu@email.com"
                        />
                      </div>
                    </div>
                    {resetEmailSent && (
                      <div className="bg-primary/10 border border-primary/20 p-4 rounded-xl flex gap-3 items-center">
                        <CheckCircle className="text-primary" size={20} />
                        <p className="text-primary font-bold text-[10px] uppercase tracking-tight leading-tight">Email enviado com sucesso!</p>
                      </div>
                    )}
                    {error && <p className="text-error-red text-xs font-bold text-center">{error}</p>}
                    <button 
                      type="submit"
                      disabled={loading}
                      className="w-full h-14 bg-primary text-white font-headline italic font-black text-xl rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest disabled:opacity-50"
                    >
                      {loading ? 'ENVIANDO...' : 'ENVIAR LINK'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleEmailLogin} className="space-y-4">
                    <div className="space-y-2">
                      <label className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-widest ml-1">Email</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
                        <input 
                          type="email" 
                          required
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white focus:border-primary outline-none transition-all"
                          placeholder="seu@email.com"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center px-1">
                        <label className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Senha</label>
                        <button 
                          type="button" 
                          onClick={() => setShowForgotPassword(true)}
                          className="text-[10px] text-primary font-bold uppercase tracking-widest hover:underline"
                        >
                          Esqueceu?
                        </button>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
                        <input 
                          type="password" 
                          required
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white focus:border-primary outline-none transition-all"
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                    {error && (
                      <div className="space-y-2">
                        <p className="text-error-red text-xs font-bold text-center">{error}</p>
                        <button 
                          type="button"
                          onClick={handleClearCache}
                          className="w-full text-[8px] text-white/40 uppercase font-bold hover:text-white text-center"
                        >
                          Problemas no login? Clique aqui para limpar o cache
                        </button>
                      </div>
                    )}
                    <button 
                      type="submit"
                      disabled={loading || isLoggingIn}
                      className="w-full h-14 bg-primary text-white font-headline italic font-black text-xl rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest disabled:opacity-50 disabled:grayscale"
                    >
                      {loading ? 'CARREGANDO...' : 'ENTRAR'}
                    </button>
                  </form>
                )}

                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-white/10"></div>
                  <span className="flex-shrink mx-4 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Ou entre com</span>
                  <div className="flex-grow border-t border-white/10"></div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <button
                    disabled={isLoggingIn || loading}
                    onClick={() => handleSocialLogin('google')}
                    className="w-full h-14 bg-white text-black font-label font-black text-xs rounded-xl shadow-lg flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest disabled:opacity-50"
                  >
                    {isLoggingIn ? (
                      <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    ) : (
                      <>
                        <img 
                          src="https://www.gstatic.com/images/branding/googleg/1x/googleg_standard_color_128dp.png" 
                          className="w-5 h-5 object-contain" 
                          alt="Google"
                          referrerPolicy="no-referrer"
                        />
                        Entrar com Google
                      </>
                    )}
                  </button>
                </div>

                <p className="text-center text-xs text-on-surface-variant font-bold uppercase tracking-widest">
                  Não tem conta? <button onClick={() => setIsRegistering(true)} className="text-primary hover:underline">Cadastre-se</button>
                </p>
              </div>
            ) : (
              <div className="space-y-6 bg-surface-container/40 backdrop-blur-xl p-8 rounded-3xl border border-white/10 shadow-2xl relative">
                {/* Header */}
<div className="flex items-center justify-between mb-4">
<div className="flex items-center gap-2">
<button onClick={() => setIsRegistering(false)} className="text-on-surface-variant hover:text-white">
<ArrowLeft size={20} />
</button>
<h2 className="font-headline italic font-black text-xl uppercase tracking-tighter">CRIAR CONTA</h2>
</div>
</div>

<form onSubmit={handleRegister} className="space-y-4">
<div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
<InputGroup icon={<User size={18} />} label="Nome Completo" value={fullName} onChange={setFullName} placeholder="João Silva" />
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
<InputGroup icon={<Fingerprint size={18} />} label="CPF" value={cpf} onChange={setCpf} placeholder="000.000.000-00" maxLength={14} />
<InputGroup icon={<Calendar size={18} />} label="Nascimento" value={birthDate} onChange={setBirthDate} type="date" />
</div>
<InputGroup icon={<Mail size={18} />} label="Email" value={email} onChange={setEmail} type="email" placeholder="seu@email.com" />
<InputGroup icon={<Lock size={18} />} label="Senha" value={password} onChange={setPassword} type="password" placeholder="••••••••" />
<InputGroup icon={<Phone size={18} />} label="WhatsApp" value={whatsapp} onChange={setWhatsapp} placeholder="(11) 99999-9999" />
<InputGroup icon={<Share2 size={18} />} label="Código de Indicação (Opcional)" value={referralCodeInput} onChange={setReferralCodeInput} placeholder="CÓDIGO-AMIGO" />

{new Date().getDate() > 1 && new Date().getDate() <= 10 && (
<div className="bg-primary/10 border border-primary/20 p-4 rounded-2xl flex items-center gap-3 animate-pulse">
<Zap size={20} className="text-primary fill-primary" />
<div className="flex-1">
<p className="text-primary font-black text-[10px] uppercase tracking-wider">Boost de Equilíbrio Ativado!</p>
<p className="text-white/60 font-medium text-[9px] uppercase leading-tight">Como você entrou no dia {new Date().getDate()}, você ganhará <span className="text-primary font-black">+{Math.round((new Date().getDate() - 1) * 15)}%</span> de pontos em todas as atividades para alcançar o topo!</p>
</div>
</div>
)}

<label className="flex items-start gap-3 cursor-pointer group bg-white/5 p-4 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
<input
type="checkbox"
checked={termsAccepted}
onChange={e => setTermsAccepted(e.target.checked)}
className="mt-1 w-5 h-5 rounded border-white/20 bg-white/5 text-primary focus:ring-primary"
/>
<span className="text-[10px] text-on-surface-variant font-bold uppercase leading-relaxed group-hover:text-white transition-colors">
Li e aceito os <span className="text-primary underline">Termos de Uso</span> e Regras do Desafio.
</span>
</label>

<label className="flex items-start gap-3 cursor-pointer group bg-white/5 p-4 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
<input
type="checkbox"
checked={whatsappOptIn}
onChange={e => setWhatsappOptIn(e.target.checked)}
className="mt-1 w-5 h-5 rounded border-white/20 bg-white/5 text-primary focus:ring-primary"
/>
<span className="text-[10px] text-on-surface-variant font-bold uppercase leading-relaxed group-hover:text-white transition-colors">
Aceito receber notificações diárias no WhatsApp para lembretes de treino e incentivos de performance.
</span>
</label>

{error && <p className="text-error-red text-xs font-bold text-center">{error}</p>}

<button
type="submit"
disabled={!fullName || !email || !password || !whatsapp || !cpf || !birthDate || !termsAccepted || loading}
className="w-full h-16 bg-primary text-white font-headline italic font-black text-xl rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest disabled:opacity-50"
>
{loading ? 'CRIANDO CONTA...' : 'CRIAR CONTA'}
</button>
</div>
</form>
              </div>
            )}
        </div>
      </div>
    );
  }

  if (user.isBlocked) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-error/10 text-error rounded-full flex items-center justify-center mb-6">
          <Lock size={40} />
        </div>
        <h1 className="font-headline italic font-black text-3xl uppercase mb-2">ACESSO BLOQUEADO</h1>
        <p className="text-on-surface-variant font-label text-sm max-w-xs uppercase tracking-widest">Sua conta foi suspensa por violação dos termos de uso ou regras do desafio.</p>
        <button onClick={() => auth.signOut()} className="mt-8 text-primary font-bold uppercase tracking-[0.2em] text-xs hover:underline">SAIR DA CONTA</button>
      </div>
    );
  }

  if (showTerms && user && !user.isBlocked) {
    return (
      <div className="fixed inset-0 z-[10000] bg-background flex flex-col items-center justify-center p-6 overflow-y-auto">
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1517836357463-d25dfeac3438?q=80&w=2000&auto=format&fit=crop" 
            alt="Background" 
            className="w-full h-full object-cover opacity-20 grayscale"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm"></div>
        </div>

        <div className="relative z-10 w-full max-w-md space-y-6 bg-surface-container/40 backdrop-blur-xl p-8 rounded-[40px] border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 bg-primary/20 rounded-2xl mx-auto flex items-center justify-center mb-2">
              <User className="text-primary" size={24} />
            </div>
            <h2 className="font-headline italic font-black text-xl text-white uppercase tracking-tighter animate-pulse">COMPLETE SEU PERFIL</h2>
            <p className="text-on-surface-variant font-label text-[9px] font-bold uppercase tracking-widest">Precisamos de mais alguns detalhes para você começar.</p>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <InputGroup 
                icon={<Fingerprint size={18} />} 
                label="CPF" 
                value={cpf} 
                onChange={setCpf} 
                placeholder="000.000.000-00" 
                maxLength={14} 
              />
              <InputGroup 
                icon={<Calendar size={18} />} 
                label="Nascimento" 
                value={birthDate} 
                onChange={setBirthDate} 
                type="date" 
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <InputGroup 
                icon={<User size={18} />} 
                label="Altura (cm)" 
                value={height} 
                onChange={setHeight} 
                type="number" 
                placeholder="175" 
              />
              <InputGroup 
                icon={<User size={18} />} 
                label="Peso (kg)" 
                value={weight} 
                onChange={setWeight} 
                type="number" 
                placeholder="75" 
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-widest ml-1">Sexo Biológico</label>
                <select 
                  value={sex}
                  onChange={e => setSex(e.target.value as any)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-4 px-4 text-white focus:border-primary outline-none transition-all appearance-none font-bold text-sm"
                >
                  <option value="male" className="bg-surface-container">Masculino</option>
                  <option value="female" className="bg-surface-container">Feminino</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-widest ml-1">Plano Desejado</label>
                <select 
                  value={preferredPlan}
                  onChange={e => setPreferredPlan(e.target.value as any)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-4 px-4 text-white focus:border-primary outline-none transition-all appearance-none font-bold text-sm"
                >
                  <option value="open" className="bg-surface-container">Plano Open (R$ 9,99/mês)</option>
                  <option value="performance" className="bg-surface-container">Plano Performance (R$ 49,90/mês)</option>
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <InputGroup 
                icon={<MapPin size={18} />} 
                label="Cidade" 
                value={city} 
                onChange={setCity} 
                placeholder="São Paulo" 
              />
              <InputGroup 
                icon={<MapPin size={18} />} 
                label="Estado" 
                value={state} 
                onChange={setState} 
                placeholder="SP" 
                maxLength={2} 
              />
            </div>

            <div className="space-y-4 pt-4 border-t border-white/5">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={termsAccepted}
                  onChange={e => setTermsAccepted(e.target.checked)}
                  className="mt-1 w-5 h-5 rounded border-white/20 bg-white/5 text-primary focus:ring-primary"
                />
                <span className="text-[10px] text-on-surface-variant font-bold uppercase leading-relaxed">
                  Li e aceito os <span className="text-primary underline">Termos de Uso</span> e Regras do Desafio.
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={whatsappOptIn}
                  onChange={e => setWhatsappOptIn(e.target.checked)}
                  className="mt-1 w-5 h-5 rounded border-white/20 bg-white/5 text-primary focus:ring-primary"
                />
                <span className="text-[10px] text-on-surface-variant font-bold uppercase leading-relaxed">
                  Aceito receber notificações no WhatsApp.
                </span>
              </label>
            </div>

            {error && <p className="text-error-red text-[10px] font-bold text-center uppercase">{error}</p>}

            <button 
              onClick={async () => {
                if (!cpf || !birthDate || !height || !weight || !city || !state || !termsAccepted) {
                  setError('Preencha todos os campos obrigatórios.');
                  return;
                }
                setLoading(true);
                setError('');
                try {
                  const cleanCpf = cpf.replace(/\D/g, '');
                  
                  // Check for duplicate CPF
                  const usersRef = collection(db, 'users');
                  const q = query(usersRef, where('cpf', '==', cleanCpf));
                  const querySnapshot = await getDocs(q);
                  
                  // Check if this CPF already belongs to ANOTHER user
                  const existingUserWithCpf = querySnapshot.docs.find(doc => doc.id !== user.uid);
                  
                  if (existingUserWithCpf) {
                    setError('Este CPF já está em uso por outra conta.');
                    setLoading(false);
                    return;
                  }

                  await updateDoc(doc(db, 'users', user.uid), {
                    cpf: cleanCpf,
                    birthDate,
                    age: birthDate ? new Date().getFullYear() - new Date(birthDate).getFullYear() : 0,
                    height: parseInt(height) || 0,
                    weight: parseInt(weight) || 0,
                    sex,
                    imc: ((parseInt(weight) || 0) / (((parseInt(height) || 0)/100) * ((parseInt(height) || 0)/100))) || 0,
                    isSubscribed: false,
                    subscriptionTier: 'Nenhum',
                    currentPlan: 'Nenhum',
                    plano: 'Nenhum',
                    assinatura: 'Inativa',
                    subscriptionStatus: 'inactive',
                    status: 'Aguardando pagamento',
                    paymentStatus: 'Aguardando pagamento',
                    statusPagamento: 'Aguardando pagamento',
                    premium: false,
                    performance: false,
                    city,
                    state: state.toUpperCase(),
                    termsAccepted: true,
                    whatsappEnabled: whatsappOptIn,
                    weeklyFrequency: user.weeklyFrequency || '3-4',
                    bodySelfAssessment: user.bodySelfAssessment || 'normal',
                    objective: user.objective || 'emagrecer',
                    league: 'Liga Beta',
                    score: 10,
                    xp: 10,
                    level: 1,
                    streak: 0,
                    weeklyScore: 0,
                    monthlyScore: 0,
                    achievements: [],
                    lastCheckIn: null,
                    positions: { global: 0, city: 0, gym: 0, national: 0, league: 0, region: 0 },
                    country: 'Brasil',
                    appCredits: 0,
                    badges: [],
                    referralCode: user.referralCode || referralService.generateReferralCode(user.uid),
                    referralStats: user.referralStats || { totalReferrals: 0, validReferrals: 0, bonusBalance: 0, referralPoints: 0 },
                    referralMilestones: user.referralMilestones || [],
                    isBlocked: false,
                    isBanned: false,
                    infractions: 0,
                    profileLikes: user.profileLikes || [],
                    totalActiveDays: 0,
                    totalWorkouts: 0,
                    walletBalance: 0
                  });
                  setShowTerms(false);
                  console.log(`[AUTH] [COMPLETE_ONBOARDING] [${user.uid}] [SUCCESS] Onboarding do perfil concluído com sucesso`);
                } catch (err: any) {
                  console.error(`[AUTH] [COMPLETE_ONBOARDING] [${user.uid}] [FAILURE] Erro ao concluir onboarding: ${err.message}`);
                  setError(err.message || 'Erro ao atualizar perfil.');
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="w-full h-14 bg-primary text-white font-headline italic font-black text-lg rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest disabled:opacity-50"
            >
              {loading ? 'SALVANDO...' : 'COMEÇAR AGORA'}
            </button>
            
            <button 
              onClick={() => auth.signOut()}
              className="w-full text-[9px] text-on-surface-variant font-bold uppercase tracking-widest hover:text-white transition-colors"
            >
              SAIR DA CONTA
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isPaid) {
    const handleVerifyStorePurchase = async (planId: string, platform: 'android' | 'ios') => {
      setPaywallLoading(true);
      setPaywallError('');
      setPaymentCheckMsg('');
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          throw new Error('Sessão inválida. Por favor, saia e faça login novamente.');
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
            planId,
            platform,
            purchaseToken: mockPurchaseToken,
            transactionId: mockTransactionId,
            scenario: 'approved'
          })
        });
        
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Erro ao validar a assinatura.');
        }
        
        if (data.success && data.status === 'approved') {
          setPaymentCheckMsg('Assinatura ativada com sucesso pelas lojas oficiais! Liberando acesso...');
          if (refreshUser) {
            await refreshUser();
          }
        } else {
          throw new Error('Falha na validação do recibo de compra.');
        }
      } catch (err: any) {
        console.error('[Store Purchase Error]', err);
        setPaywallError(err.message || 'Falha ao processar assinatura.');
      } finally {
        setPaywallLoading(false);
      }
    };

    return (
      <div className="min-h-screen bg-background text-on-background flex flex-col items-center justify-center p-4 md:p-6 select-none font-sans">
        <div className="w-full max-w-md bg-surface border border-surface-variant rounded-2xl p-6 md:p-8 space-y-6 shadow-2xl relative overflow-hidden">
          {/* Decorative gradients */}
          <div className="absolute top-0 left-1/4 w-40 h-40 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 right-1/4 w-45 h-45 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

          {/* Logo / Header */}
          <div className="flex flex-col items-center text-center space-y-2">
            <InvictusLogo className="h-10 text-primary" />
            <h1 className="text-xl md:text-2xl font-headline italic font-black text-white tracking-wider uppercase mt-4">
              Escolha um plano para começar
            </h1>
            <p className="text-xs text-on-surface-variant font-semibold uppercase tracking-widest">
              Invictus Performance
            </p>
          </div>

          {/* Dual Plan Selector */}
          <div className="space-y-4">
            {/* Plano Básico */}
            <button
              onClick={() => setSelectedPlanId('invictus_open')}
              disabled={!!pendingOrder}
              className={`w-full text-left p-4 rounded-xl border transition-all flex flex-col justify-between gap-1 cursor-pointer ${
                selectedPlanId === 'invictus_open'
                  ? 'bg-primary/5 border-primary shadow-lg shadow-primary/5'
                  : 'bg-background/40 border-surface-variant/80 hover:border-white/20'
              }`}
            >
              <div className="flex justify-between items-center w-full">
                <span className="text-sm font-bold uppercase tracking-wider text-white">Plano Básico</span>
                <span className="text-lg font-headline italic font-black text-primary">R$ 9,90<span className="text-[10px] font-normal not-italic text-on-surface-variant">/mês</span></span>
              </div>
              <p className="text-[10px] text-on-surface-variant font-medium uppercase mt-1">
                Acesso total aos treinos diários, periodizações e rankings.
              </p>
            </button>

            {/* Plano Performance */}
            <button
              onClick={() => setSelectedPlanId('invictus_performance')}
              disabled={!!pendingOrder}
              className={`w-full text-left p-4 rounded-xl border transition-all flex flex-col justify-between gap-1 cursor-pointer ${
                selectedPlanId === 'invictus_performance'
                  ? 'bg-primary/5 border-primary shadow-lg shadow-primary/5'
                  : 'bg-background/40 border-surface-variant/80 hover:border-white/20'
              }`}
            >
              <div className="flex justify-between items-center w-full">
                <span className="text-sm font-bold uppercase tracking-wider text-white">Plano Performance</span>
                <span className="text-lg font-headline italic font-black text-primary">R$ 49,90<span className="text-[10px] font-normal not-italic text-on-surface-variant">/mês</span></span>
              </div>
              <p className="text-[10px] text-on-surface-variant font-medium uppercase mt-1">
                Acesso Elite, Gráficos Biométricos avançados, Integração com Smartwatch e IA.
              </p>
            </button>
          </div>

          {/* Benefits list (Dynamic based on selected plan) */}
          <div className="bg-background/50 border border-surface-variant/50 rounded-xl p-4 space-y-2">
            <span className="text-[9px] font-black uppercase text-on-surface-variant tracking-wider block mb-1">
              Recursos inclusos no plano selecionado:
            </span>
            {selectedPlanId === 'invictus_open' ? (
              <>
                <div className="flex items-start gap-2 text-xs text-on-surface">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Acesso total aos treinos diários e periodizações</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-on-surface">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Participação nos rankings de academias e nacional</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-on-surface">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Registro de evolução física real</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-2 text-xs text-on-surface">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Todos os recursos do plano Básico</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-on-surface">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Central Biométrica e conexão com Smartwatch</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-on-surface">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Insights e planos avançados gerados por IA</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-on-surface">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Monitoramento contínuo e relatórios fisiológicos Whoop Style</span>
                </div>
              </>
            )}
          </div>

          {/* Error and messages */}
          {paywallError && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-4 flex gap-3 items-start text-xs leading-relaxed">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{paywallError}</span>
            </div>
          )}

          {paymentCheckMsg && (
            <div className="bg-primary/10 border border-primary/20 text-primary rounded-xl p-4 flex gap-3 items-start text-xs leading-relaxed">
              <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{paymentCheckMsg}</span>
            </div>
          )}

          {/* Call to Actions */}
          <div className="space-y-4">
            <div className="bg-surface-variant/10 border border-surface-variant rounded-2xl p-4 text-center space-y-2">
              <span className="text-[10px] font-black uppercase text-primary tracking-widest">
                Assinatura In-App Nativa (Google Play / App Store)
              </span>
              <p className="text-[9.5px] text-on-surface-variant leading-relaxed">
                Nenhum gateway externo. Selecione o sistema operacional desejado para validar e simular a compra oficial do seu plano <strong>{selectedPlanId === 'invictus_open' ? 'Básico' : 'Performance'}</strong>:
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleVerifyStorePurchase(selectedPlanId, 'android')}
                disabled={paywallLoading}
                className="h-14 bg-emerald-500 hover:bg-emerald-400 text-black font-headline italic font-black text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all uppercase tracking-wider disabled:opacity-50"
              >
                {paywallLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-black" />
                ) : (
                  <>
                    <span>🤖 Play Store</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleVerifyStorePurchase(selectedPlanId, 'ios')}
                disabled={paywallLoading}
                className="h-14 bg-white hover:bg-white/90 text-black font-headline italic font-black text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all uppercase tracking-wider disabled:opacity-50"
              >
                {paywallLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-black" />
                ) : (
                  <>
                    <span> App Store</span>
                  </>
                )}
              </button>
            </div>

            {/* Logout button */}
            <button
              onClick={() => auth.signOut()}
              className="w-full h-11 border border-surface-variant hover:border-white text-on-surface-variant hover:text-white font-headline italic font-black rounded-xl text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all mt-4"
            >
              <LogOut className="h-4 w-4" />
              Sair da Conta
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
    </>
  );
}

function InputGroup({ icon, label, value, onChange, type = "text", placeholder, maxLength }: any) {
  return (
    <div className="space-y-2">
      <label className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-widest ml-1">{label}</label>
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
          {icon}
        </div>
        <input 
          type={type} 
          required
          maxLength={maxLength}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white focus:border-primary outline-none transition-all text-sm font-bold"
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
