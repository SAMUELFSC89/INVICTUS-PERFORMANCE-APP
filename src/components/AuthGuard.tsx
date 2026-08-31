import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { 
  auth, 
  db, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  GoogleAuthProvider, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification
} from '../firebase';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { purchasePerformanceSubscription } from '../lib/revenuecat';
import { UserProfile } from '../types';
import { Lock, User, MapPin, CheckCircle, Calendar, Fingerprint, AlertTriangle, Loader2, LogOut, Sparkles } from 'lucide-react';
import { referralService } from '../services/referralService';
import { useUser } from '../UserContext';
import { InvictusLogo } from './InvictusLogo';
import { AuthExperience, RegistrationField } from './AuthExperience';
import { CURRENT_LEGAL_VERSION } from '../lib/legalDocuments';

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

async function isCpfAlreadyInUse(firebaseUser: { getIdToken: () => Promise<string> }, cpf: string): Promise<boolean> {
  const token = await firebaseUser.getIdToken();
  const response = await fetch('/api/profile?action=check-cpf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ cpf })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível validar o CPF agora.');
  return Boolean(payload.exists);
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: contextLoading, refreshUser } = useUser();
  const [loading, setLoading] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  // Paywall states
  const [pendingOrder, setPendingOrder] = useState<any>(null);
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
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [weeklyFrequency] = useState<UserProfile['weeklyFrequency']>('3-4');
  const [physicalSelfAssessment] = useState<UserProfile['bodySelfAssessment']>('normal');
  const [objective] = useState<UserProfile['objective']>('emagrecer');
  const [sex, setSex] = useState<UserProfile['sex']>('male');
  const [preferredPlan, setPreferredPlan] = useState<'open' | 'performance'>('open');
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [registrationStep, setRegistrationStep] = useState(1);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<'invictus_open' | 'invictus_performance'>('invictus_open');

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
      // `league` pertence ao ecossistema antigo e academia/cidade são dados
      // opcionais de ranking. Nenhum deles pode prender uma conta válida no
      // onboarding legado. O único bloqueio global aqui é o consentimento.
      const isIncomplete = !user.termsAccepted;
      setShowTerms(isIncomplete);
    }
  }, [user]);

  // Validação de acesso da conta em produção (Membro Open, Performance PRO e Administrador)
  const isPaid = user?.subscriptionStatus === 'active_basic' || user?.subscriptionStatus === 'active_premium' || user?.isSubscribed || user?.role === 'admin' || user?.subscriptionTier === 'open';

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

  const handleSocialLogin = async () => {
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
      console.log('[AUTH] [RESET_PASSWORD] [SUCCESS] E-mail de redefinição enviado');
    } catch (err: any) {
      console.error(`[AUTH] [RESET_PASSWORD] [FAILURE] Erro ao enviar e-mail: ${err.message}`);
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
      console.error(`[AUTH] [LOGIN] [FAILURE] Erro ao autenticar: ${err.message}`);
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
      
      // A consulta de CPF ocorre somente no endpoint autenticado, que devolve
      // um booleano sem expor perfis de terceiros.
      const cleanCpf = cpf.replace(/\D/g, '');
      const cpfAlreadyInUse = await isCpfAlreadyInUse(res.user, cleanCpf);
      
      if (cpfAlreadyInUse) {
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
        termsVersionAccepted: CURRENT_LEGAL_VERSION,
        termsAcceptedAt: new Date().toISOString(),
        whatsappEnabled: whatsappOptIn,
        phoneNumber: whatsapp,
        plano: preferredPlan === 'open' ? 'Invictus Open' : 'Nenhum',
        currentPlan: preferredPlan === 'open' ? 'invictus_open' : 'Nenhum',
        assinatura: preferredPlan === 'open' ? 'Ativa' : 'Inativa',
        subscriptionStatus: preferredPlan === 'open' ? 'active_basic' : 'inactive',
        status: 'Ativo',
        paymentStatus: 'Não aplicável',
        statusPagamento: 'Não aplicável',
        premium: false,
        performance: false,
        isSubscribed: preferredPlan === 'open',
        subscriptionTier: preferredPlan === 'open' ? 'open' : 'Nenhum',
        role: 'user',
        league: 'Comunidade Invictus',
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
          await referralService.createReferral(referralCodeInput);
          console.log(`[AUTH] [REFERRAL] [${res.user.uid}] [SUCCESS] Indicação vinculada ao código ${referralCodeInput}`);
        }
      }
      
      sessionStorage.removeItem('is_registering_user');
      if (refreshUser) {
        await refreshUser();
      }
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use' || err?.message?.includes('email-already-in-use')) {
        console.warn('[AUTH] [REGISTER] E-mail em uso. Verificando se o perfil existe ou se é uma reativação...');
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
              plano: preferredPlan === 'open' ? 'Invictus Open' : 'Nenhum',
              currentPlan: preferredPlan === 'open' ? 'invictus_open' : 'Nenhum',
              assinatura: preferredPlan === 'open' ? 'Ativa' : 'Inativa',
              subscriptionStatus: preferredPlan === 'open' ? 'active_basic' : 'inactive',
              status: 'Ativo',
              paymentStatus: 'Não aplicável',
              statusPagamento: 'Não aplicável',
              premium: false,
              performance: false,
              isSubscribed: preferredPlan === 'open',
              subscriptionTier: preferredPlan === 'open' ? 'open' : 'Nenhum',
              role: 'user',
              league: 'Comunidade Invictus',
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
      <div className="auth-experience"><div className="auth-ambient" aria-hidden="true"><span /><span /><span /></div><div className="auth-shell"><div className="auth-brand"><InvictusLogo size={84} showText /><p>{isRedirecting ? 'FINALIZANDO LOGIN' : isLoggingIn ? 'AUTENTICANDO' : 'CARREGANDO SEU PERFIL'}</p></div></div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthExperience
        registering={isRegistering}
        forgotPassword={showForgotPassword}
        resetEmailSent={resetEmailSent}
        loading={loading}
        socialLoading={isLoggingIn}
        error={error}
        step={registrationStep}
        fields={{ fullName, cpf, birthDate, email, password, whatsapp, referralCode: referralCodeInput }}
        termsAccepted={termsAccepted}
        whatsappOptIn={whatsappOptIn}
        preferredPlan={preferredPlan}
        onField={(field: RegistrationField, value: string) => ({ fullName: setFullName, cpf: setCpf, birthDate: setBirthDate, email: setEmail, password: setPassword, whatsapp: setWhatsapp, referralCode: setReferralCodeInput }[field])(value)}
        onLogin={handleEmailLogin}
        onRegister={handleRegister}
        onForgot={handleForgotPassword}
        onGoogle={handleSocialLogin}
        onClearCache={handleClearCache}
        onRegistering={(value) => { setIsRegistering(value); setRegistrationStep(1); setError(''); }}
        onForgotPassword={(value) => { setShowForgotPassword(value); setError(''); }}
        onStep={(step) => { setRegistrationStep(step); setError(''); }}
        onTerms={setTermsAccepted}
        onWhatsappOptIn={setWhatsappOptIn}
        onPlan={setPreferredPlan}
      />
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
      <div className="fixed inset-0 z-[10000] bg-[#030303] flex flex-col items-center justify-center p-6 overflow-y-auto">
        <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_5%,rgba(232,173,21,.16),transparent_32%),linear-gradient(135deg,#020202,#0b0905,#020202)]"></div>

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
                  <option value="open" className="bg-surface-container">Plano Free (Grátis)</option>
                  <option value="performance" className="bg-surface-container">Plano Pro (R$ 29,90/mês)</option>
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
                  Li e aceito os <span className="text-primary underline">Termos de Uso</span> e a Política de Privacidade. Permissões sensíveis serão solicitadas separadamente.
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
                if (!cpf || !birthDate || !termsAccepted) {
                  setError('Informe CPF, data de nascimento e aceite os termos para continuar.');
                  return;
                }
                setLoading(true);
                setError('');
                try {
                  const cleanCpf = cpf.replace(/\D/g, '');
                  
                  const firebaseUser = auth.currentUser;
                  if (!firebaseUser) throw new Error('Sua sessão expirou. Faça login novamente.');
                  const cpfAlreadyInUse = await isCpfAlreadyInUse(firebaseUser, cleanCpf);
                  if (cpfAlreadyInUse) {
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
                    isSubscribed: preferredPlan === 'open',
                    subscriptionTier: preferredPlan === 'open' ? 'open' : 'Nenhum',
                    currentPlan: preferredPlan === 'open' ? 'invictus_open' : 'Nenhum',
                    plano: preferredPlan === 'open' ? 'Invictus Open' : 'Nenhum',
                    assinatura: preferredPlan === 'open' ? 'Ativa' : 'Inativa',
                    subscriptionStatus: preferredPlan === 'open' ? 'active_basic' : 'inactive',
                    status: 'Ativo',
                    paymentStatus: 'Não aplicável',
                    statusPagamento: 'Não aplicável',
                    premium: false,
                    performance: false,
                    city,
                    state: state.toUpperCase(),
                    termsAccepted: true,
                    termsVersionAccepted: CURRENT_LEGAL_VERSION,
                    termsAcceptedAt: new Date().toISOString(),
                    whatsappEnabled: whatsappOptIn,
                    weeklyFrequency: user.weeklyFrequency || '3-4',
                    bodySelfAssessment: user.bodySelfAssessment || 'normal',
                    objective: user.objective || 'emagrecer',
                    league: 'Comunidade Invictus',
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

      // Plano Pro: executa a compra real na loja (Google Play/App Store)
      // antes de pedir ao backend para confirmar. O Plano Free é gratuito e nunca
      // passa por nenhuma loja.
      if (planId === 'invictus_performance') {
        await purchasePerformanceSubscription();
      }

      const response = await fetch('/api/payments/verify-purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ planId, platform })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao validar a assinatura.');
      }

      if (data.success && data.status === 'approved') {
        setPaymentCheckMsg(planId === 'invictus_open'
          ? 'Plano Free ativado com sucesso! Liberando acesso...'
          : 'Assinatura ativada com sucesso pelas lojas oficiais! Liberando acesso...');
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
            {/* Plano Free */}
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
                <span className="text-sm font-bold uppercase tracking-wider text-white">Plano Free</span>
                <span className="text-lg font-headline italic font-black text-primary">Grátis</span>
              </div>
              <p className="text-[10px] text-on-surface-variant font-medium uppercase mt-1">
                Acesso total aos treinos diários, periodizações e rankings.
              </p>
            </button>

            {/* Plano Pro */}
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
                <span className="text-sm font-bold uppercase tracking-wider text-white">Plano Pro</span>
                <span className="text-lg font-headline italic font-black text-primary">R$ 29,90<span className="text-[10px] font-normal not-italic text-on-surface-variant">/mês</span></span>
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
{selectedPlanId === 'invictus_open' ? 'Comece Agora, é Grátis!' : 'Assinatura In-App Nativa (Google Play / App Store)'}
</span>
<p className="text-[9.5px] text-on-surface-variant leading-relaxed">
{selectedPlanId === 'invictus_open'
? 'Sem custo e sem necessidade de cartão. Ative seu acesso ao Plano Free agora mesmo.'
: 'Nenhum gateway externo. Selecione o sistema operacional desejado para validar e simular a compra oficial do seu plano Performance:'}
</p>
</div>

{selectedPlanId === 'invictus_open' ? (
<button
onClick={() => handleVerifyStorePurchase('invictus_open', 'android')}
disabled={paywallLoading}
className="w-full h-14 bg-primary hover:bg-primary-hover text-white font-headline italic font-black text-sm rounded-xl flex items-center justify-center gap-1.5 transition-all uppercase tracking-wider disabled:opacity-50"
>
{paywallLoading ? (
<Loader2 className="h-4 w-4 animate-spin text-white" />
) : (
<span>Começar Grátis</span>
)}
</button>
) : (
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
<span> App Store</span>
</>
)}
</button>
</div>
)}

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
