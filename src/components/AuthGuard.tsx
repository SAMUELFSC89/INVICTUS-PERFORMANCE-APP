import React, { useEffect, useRef, useState } from 'react';
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
import { doc, getDoc } from 'firebase/firestore';
import {
  getPerformanceSubscriptionOffer,
  purchasePerformanceSubscription,
  restorePerformanceSubscription,
  type PerformanceSubscriptionOffer,
} from '../lib/revenuecat';
import { UserProfile } from '../types';
import { Lock, User, MapPin, CheckCircle, Calendar, Fingerprint, AlertTriangle, Loader2, LogOut, RefreshCw, Sparkles } from 'lucide-react';
import { referralService } from '../services/referralService';
import { useUser } from '../UserContext';
import { InvictusLogo } from './InvictusLogo';
import { AuthExperience, RegistrationField } from './AuthExperience';
import { CURRENT_LEGAL_VERSION } from '../lib/legalDocuments';
import { hasActiveProEntitlement } from '../lib/proEntitlement';
import {
  clearPendingSubscriptionVerification,
  createPendingSubscriptionVerification,
  isSubscriptionProvisioned,
  isTerminalInactiveSubscription,
  readPendingSubscriptionVerification,
  savePendingSubscriptionVerification,
  type PendingSubscriptionVerification,
} from '../lib/subscriptionVerification';

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

// SEC-01 / AP-01 (auditoria 6167c8f): única forma de criar ou concluir o
// cadastro do perfil. O cliente nunca mais grava score/xp/plano/bloqueio
// direto no Firestore -- só declara os campos abaixo, e o servidor (Admin
// SDK) decide os campos privilegiados de forma idempotente. Chamar de novo,
// com qualquer subconjunto de campos, é sempre seguro (cobre reload no meio
// do cadastro e onboarding incompleto do login social).
type OnboardPayload = Partial<{
  displayName: string;
  cpf: string;
  birthDate: string;
  height: string | number;
  weight: string | number;
  sex: string;
  weeklyFrequency: string;
  bodySelfAssessment: string;
  objective: string;
  preferredPlan: string;
  city: string;
  state: string;
  whatsappEnabled: boolean;
  phoneNumber: string;
  termsAccepted: boolean;
  termsVersionAccepted: string | number;
}>;

type PerformanceOfferState = {
  uid: string;
  status: 'loading' | 'ready' | 'error';
  offer: PerformanceSubscriptionOffer | null;
  error: string;
};

type SubscriptionAction = 'purchase' | 'restore' | 'verify' | null;

export function formatSubscriptionPeriod(period: string | null): string {
  if (!period) return '';

  const match = /^P(\d+)([DWMY])$/.exec(period);
  if (!match) return '';

  const amount = Number(match[1]);
  const unit = match[2];
  const singular: Record<string, string> = {
    D: 'dia',
    W: 'semana',
    M: 'mês',
    Y: 'ano',
  };
  const plural: Record<string, string> = {
    D: 'dias',
    W: 'semanas',
    M: 'meses',
    Y: 'anos',
  };

  if (!Number.isInteger(amount) || amount <= 0 || !singular[unit]) return '';
  return amount === 1 ? `/${singular[unit]}` : `/${amount} ${plural[unit]}`;
}

async function completeOnboarding(
  firebaseUser: { getIdToken: () => Promise<string> },
  fields: OnboardPayload
): Promise<{ success: boolean; alreadyOnboarded: boolean; onboardingComplete: boolean }> {
  const token = await firebaseUser.getIdToken();
  const response = await fetch('/api/profile?action=onboard', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(fields)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir o cadastro agora.');
  return payload;
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: contextLoading, refreshUser } = useUser();
  const [loading, setLoading] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  // Paywall states
  const [paywallLoading, setPaywallLoading] = useState(false);
  const [subscriptionAction, setSubscriptionAction] = useState<SubscriptionAction>(null);
  const [paywallError, setPaywallError] = useState('');
  const [paymentCheckMsg, setPaymentCheckMsg] = useState('');
  const [performanceOfferState, setPerformanceOfferState] = useState<PerformanceOfferState | null>(null);
  const [pendingVerification, setPendingVerification] = useState<PendingSubscriptionVerification | null>(null);
  const [verificationHydratedUid, setVerificationHydratedUid] = useState<string | null>(null);
  const subscriptionActionRef = useRef(false);
  
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
      // onboarding legado. Os dois bloqueios globais aqui são o consentimento
      // e a data de nascimento -- sem ela, jornadas de cardio (que exigem
      // confirmação de maioridade) ficavam num beco sem saída: o erro pedia
      // pra "confirmar no perfil", mas não existe nenhum campo de data de
      // nascimento na tela de Perfil pra corrigir isso (ver #cardio-dob-fix).
      // Esta tela já coleta e grava birthDate, então é o lugar certo pra
      // resolver contas legadas/onboarding social que nunca preencheram.
      const isIncomplete = !user.termsAccepted || !user.birthDate;
      setShowTerms(isIncomplete);
    }
  }, [user]);

  // Quando o gate acima reabre pra alguém que só está faltando a data de
  // nascimento (termos já aceitos, resto do perfil já preenchido antes),
  // preenche os campos já conhecidos -- sem isso a pessoa seria forçada a
  // redigitar CPF/altura/peso/cidade que ela já informou, só pra corrigir
  // um único campo faltante.
  useEffect(() => {
    if (!user) return;
    if (user.cpf) setCpf(user.cpf);
    if (user.birthDate) setBirthDate(user.birthDate.slice(0, 10));
    if (user.height) setHeight(String(user.height));
    if (user.weight) setWeight(String(user.weight));
    if (user.city) setCity(user.city);
    if (user.state) setState(user.state);
    if (user.sex) setSex(user.sex);
    if (user.termsAccepted) setTermsAccepted(true);
  }, [user?.uid]);

  // O Plano Open mantém o acesso básico; o Pro exige tier, status e validade
  // canônicos. Flags legadas isoladas nunca liberam o paywall.
  const hasBasicAccess = user?.subscriptionStatus === 'active_basic' || user?.subscriptionTier === 'open';
  const isPaid = hasBasicAccess || hasActiveProEntitlement(user);
  const capacitorPlatform = Capacitor.getPlatform();
  const nativeStorePlatform: 'android' | 'ios' | null = capacitorPlatform === 'android' || capacitorPlatform === 'ios'
    ? capacitorPlatform
    : null;
  const nativeStoreName = nativeStorePlatform === 'ios' ? 'App Store' : 'Google Play';
  const currentPendingVerification = pendingVerification?.uid === user?.uid ? pendingVerification : null;
  const verificationHydrated = Boolean(user?.uid && verificationHydratedUid === user.uid);
  const currentOfferState = performanceOfferState?.uid === user?.uid ? performanceOfferState : null;
  const performanceOffer = currentOfferState?.status === 'ready' ? currentOfferState.offer : null;
  const performanceOfferError = currentOfferState?.status === 'error' ? currentOfferState.error : '';
  const shouldLoadPerformanceOffer = Boolean(
    user
    && !showTerms
    && !isPaid
    && selectedPlanId === 'invictus_performance'
    && nativeStorePlatform
    && verificationHydrated
    && !currentPendingVerification
  );
  const performanceOfferLoading = Boolean(
    selectedPlanId === 'invictus_performance'
    && nativeStorePlatform
    && (!verificationHydrated || (shouldLoadPerformanceOffer && currentOfferState?.status !== 'ready' && currentOfferState?.status !== 'error'))
  );

  useEffect(() => {
    const uid = user?.uid;
    setPendingVerification(null);
    setVerificationHydratedUid(null);
    setPaywallError('');
    setPaymentCheckMsg('');

    if (!uid) return;
    const stored = readPendingSubscriptionVerification(uid);
    setPendingVerification(stored);
    setVerificationHydratedUid(uid);
    if (stored) setSelectedPlanId('invictus_performance');
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !currentPendingVerification || !hasActiveProEntitlement(user)) return;
    clearPendingSubscriptionVerification(user.uid);
    setPendingVerification(null);
  }, [currentPendingVerification, user]);

  useEffect(() => {
    let cancelled = false;

    if (
      !user
      || showTerms
      || isPaid
      || selectedPlanId !== 'invictus_performance'
      || !nativeStorePlatform
      || !verificationHydrated
      || currentPendingVerification
    ) {
      setPerformanceOfferState(null);
      return () => {
        cancelled = true;
      };
    }

    const uid = user.uid;
    setPerformanceOfferState({ uid, status: 'loading', offer: null, error: '' });

    getPerformanceSubscriptionOffer(uid)
      .then((offer) => {
        if (!cancelled) setPerformanceOfferState({ uid, status: 'ready', offer, error: '' });
      })
      .catch((offerError: unknown) => {
        if (cancelled) return;
        const message = offerError instanceof Error ? offerError.message : 'Não foi possível consultar a oferta da loja.';
        setPerformanceOfferState({ uid, status: 'error', offer: null, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentPendingVerification?.storeCompletedAt,
    isPaid,
    nativeStorePlatform,
    selectedPlanId,
    showTerms,
    user?.uid,
    verificationHydrated,
  ]);

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

      // SEC-01 / AP-01 (auditoria 6167c8f): o perfil não é mais gravado direto
      // pelo cliente (setDoc) -- só o servidor decide campos privilegiados
      // (score, xp, plano, bloqueio etc.), de forma idempotente.
      await completeOnboarding(res.user, {
        displayName: fullName,
        cpf: cleanCpf,
        birthDate,
        height,
        weight,
        sex,
        weeklyFrequency,
        bodySelfAssessment: physicalSelfAssessment,
        objective,
        preferredPlan,
        city,
        state: state.toUpperCase(),
        whatsappEnabled: whatsappOptIn,
        phoneNumber: whatsapp,
        termsAccepted: true,
        termsVersionAccepted: CURRENT_LEGAL_VERSION
      });
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
            // SEC-01 / AP-01: mesma migração acima -- o servidor decide os
            // campos privilegiados, o cliente só declara os dados informados.
            await completeOnboarding(signInRes.user, {
              displayName: fullName,
              cpf: cleanCpf,
              birthDate,
              height,
              weight,
              sex,
              weeklyFrequency,
              bodySelfAssessment: physicalSelfAssessment,
              objective,
              preferredPlan,
              city,
              state: state.toUpperCase(),
              whatsappEnabled: whatsappOptIn,
              phoneNumber: whatsapp,
              termsAccepted: true,
              termsVersionAccepted: CURRENT_LEGAL_VERSION
            });
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

  // Nunca renderize filhos, onboarding ou paywall enquanto a identidade/perfil
  // estiver mudando. Um perfil em cache ou da conta anterior não é autorização.
  if (isGlobalLoading) {
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

  if (user.isBlocked || user.isBanned || user.isSuspended || ['deleted', 'blocked', 'banned', 'suspended'].includes(String(user.status || '').toLowerCase())) {
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

  if (showTerms && user && !user.isBlocked && !user.isBanned && !user.isSuspended) {
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
                  <option value="performance" className="bg-surface-container">Plano Pro</option>
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

                  // SEC-01 / AP-01 (auditoria 6167c8f): onboarding do login
                  // social também passa pelo servidor -- antes este updateDoc()
                  // enviava isSubscribed/subscriptionTier/xp/score/level direto
                  // do cliente, que agora ficam bloqueados pelas Firestore
                  // Rules e seriam negados (deixando o usuário travado aqui).
                  await completeOnboarding(firebaseUser, {
                    displayName: user.displayName,
                    cpf: cleanCpf,
                    birthDate,
                    height,
                    weight,
                    sex,
                    weeklyFrequency: user.weeklyFrequency || '3-4',
                    bodySelfAssessment: user.bodySelfAssessment || 'normal',
                    objective: user.objective || 'emagrecer',
                    preferredPlan,
                    city,
                    state: state.toUpperCase(),
                    whatsappEnabled: whatsappOptIn,
                    termsAccepted: true,
                    termsVersionAccepted: CURRENT_LEGAL_VERSION
                  });
                  if (refreshUser) {
                    await refreshUser();
                  }
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
    const runPaywallAction = async (
      action: Exclude<SubscriptionAction, null>,
      uid: string,
      operation: () => Promise<void>,
    ) => {
      if (subscriptionActionRef.current) return;
      subscriptionActionRef.current = true;
      setPaywallLoading(true);
      setSubscriptionAction(action);
      setPaywallError('');
      setPaymentCheckMsg('');

      try {
        if (auth.currentUser?.uid !== uid) throw new Error('A conta mudou. Volte à assinatura e tente novamente na conta correta.');
        await operation();
      } catch (reason: unknown) {
        console.error('[Store Purchase Error]', reason);
        if (auth.currentUser?.uid === uid) {
          setPaywallError(reason instanceof Error ? reason.message : 'Falha ao processar assinatura.');
        }
      } finally {
        subscriptionActionRef.current = false;
        setPaywallLoading(false);
        setSubscriptionAction(null);
      }
    };

    const refreshAfterProvisioning = async (uid: string): Promise<boolean> => {
      if (auth.currentUser?.uid !== uid) return false;
      try {
        const refreshedProfile = await refreshUser?.();
        return auth.currentUser?.uid === uid && hasActiveProEntitlement(refreshedProfile);
      } catch (refreshError) {
        // O servidor já aplicou o benefício. Falha ao reler o perfil não pode
        // transformar uma confirmação forte em nova tentativa de compra.
        console.error('[Store Purchase] Benefício aplicado, mas o perfil não foi recarregado:', refreshError);
        return false;
      }
    };

    const confirmPerformanceWithServer = async (pending: PendingSubscriptionVerification) => {
      const currentAccount = auth.currentUser;
      if (!currentAccount || currentAccount.uid !== pending.uid) {
        throw new Error('A conta mudou antes da confirmação. Entre novamente na conta que concluiu a operação na loja.');
      }
      const token = await currentAccount.getIdToken();
      if (auth.currentUser?.uid !== pending.uid) {
        throw new Error('A conta mudou antes da confirmação. Nenhum benefício foi aplicado à conta incorreta.');
      }

      const response = await fetch('/api/payments/verify-purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          planId: 'invictus_performance',
          platform: pending.platform,
          productId: pending.productIdentifier,
          packageIdentifier: pending.packageIdentifier,
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (isTerminalInactiveSubscription(payload) && auth.currentUser?.uid === pending.uid) {
          clearPendingSubscriptionVerification(pending.uid);
          setPendingVerification(null);
        }
        throw new Error(payload.error || 'A loja confirmou a operação, mas o servidor ainda não conseguiu aplicar o benefício. Tente confirmar novamente.');
      }
      if (!isSubscriptionProvisioned(payload)) {
        throw new Error(payload.error || 'A resposta ainda não confirma que o benefício Pro foi aplicado. Tente confirmar novamente.');
      }

      if (auth.currentUser?.uid === pending.uid) {
        const profileConfirmed = await refreshAfterProvisioning(pending.uid);
        if (profileConfirmed) {
          clearPendingSubscriptionVerification(pending.uid);
          setPendingVerification(null);
          setPaymentCheckMsg('Assinatura confirmada pela loja e benefícios Pro aplicados!');
        } else {
          // O POST confirmou o provisionamento, mas o cliente ainda não leu a
          // projeção canônica. Mantemos a intenção para retry somente-servidor.
          setPaymentCheckMsg('Benefício aplicado pelo servidor. Sincronize novamente para atualizar este dispositivo; nenhuma nova compra será aberta.');
        }
      }
    };

    const handlePerformanceStoreAction = async (operation: 'purchase' | 'restore') => {
      const uid = user.uid;
      const platform = nativeStorePlatform;
      const selectedOffer = performanceOffer;
      if (!platform) {
        setPaywallError('Assine ou restaure o Plano Pro pelo aplicativo instalado no Android ou iOS.');
        return;
      }
      if (!verificationHydrated || (operation === 'purchase' && performanceOfferLoading)) return;
      if (currentPendingVerification && operation === 'purchase') {
        await runPaywallAction('verify', uid, () => confirmPerformanceWithServer(currentPendingVerification));
        return;
      }
      if (operation === 'purchase' && !selectedOffer) {
        setPaywallError(performanceOfferError || 'A oferta da loja ainda não está disponível. Tente novamente.');
        return;
      }

      await runPaywallAction(operation, uid, async () => {
        const result = operation === 'purchase'
          ? await purchasePerformanceSubscription(uid)
          : await restorePerformanceSubscription(uid);
        if (result.active !== true || !result.productIdentifier?.trim()) {
          throw new Error('A loja não confirmou uma assinatura Performance ativa.');
        }

        const pending = createPendingSubscriptionVerification({
          uid,
          platform,
          operation,
          productIdentifier: result.productIdentifier,
          packageIdentifier: operation === 'purchase' ? selectedOffer?.packageIdentifier : undefined,
        });

        // Gravar antes do POST garante retomada após timeout, reload ou ACK perdido.
        const persisted = savePendingSubscriptionVerification(pending);
        if (auth.currentUser?.uid === uid) setPendingVerification(pending);

        try {
          await confirmPerformanceWithServer(pending);
        } catch (verificationError) {
          if (!persisted) {
            const message = verificationError instanceof Error ? verificationError.message : 'A confirmação do servidor falhou.';
            throw new Error(`${message} Mantenha esta tela aberta e tente confirmar novamente.`);
          }
          throw verificationError;
        }
      });
    };

    const handleOpenActivation = async () => {
      const uid = user.uid;
      await runPaywallAction('verify', uid, async () => {
        const currentAccount = auth.currentUser;
        if (!currentAccount || currentAccount.uid !== uid) throw new Error('Sessão inválida. Faça login novamente.');
        const token = await currentAccount.getIdToken();
        if (auth.currentUser?.uid !== uid) throw new Error('A conta mudou antes da ativação. Tente novamente na conta correta.');

        const response = await fetch('/api/payments/verify-purchase', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            planId: 'invictus_open',
            platform: 'internal',
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || 'Erro ao ativar o Plano Free.');
        }
        if (!isSubscriptionProvisioned(data)) {
          throw new Error(data.error || 'O servidor ainda não confirmou a ativação do Plano Free.');
        }

        setPaymentCheckMsg('Plano Free ativado com sucesso! Liberando acesso...');
        await refreshAfterProvisioning(uid);
      });
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
              disabled={paywallLoading || !verificationHydrated || !!currentPendingVerification}
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
              disabled={paywallLoading || !verificationHydrated}
              className={`w-full text-left p-4 rounded-xl border transition-all flex flex-col justify-between gap-1 cursor-pointer ${
                selectedPlanId === 'invictus_performance'
                  ? 'bg-primary/5 border-primary shadow-lg shadow-primary/5'
                  : 'bg-background/40 border-surface-variant/80 hover:border-white/20'
              }`}
            >
              <div className="flex justify-between items-center w-full">
                <span className="text-sm font-bold uppercase tracking-wider text-white">Plano Pro</span>
                <span className="text-right font-headline italic font-black text-primary">
                  {currentPendingVerification
                    ? <span className="text-xs">Compra confirmada</span>
                    : performanceOfferLoading
                    ? <span className="text-xs">Consultando loja...</span>
                    : performanceOffer
                      ? (
                        <>
                          <span className="text-lg">{performanceOffer.priceString}</span>
                          <span className="text-[10px] font-normal not-italic text-on-surface-variant">
                            {formatSubscriptionPeriod(performanceOffer.subscriptionPeriod)}
                          </span>
                        </>
                      )
                      : <span className="text-xs">{nativeStorePlatform ? 'Oferta indisponível' : 'Pelo app'}</span>}
                </span>
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

          {selectedPlanId === 'invictus_performance' && performanceOfferError && !paywallError && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-4 flex gap-3 items-start text-xs leading-relaxed">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{performanceOfferError}</span>
            </div>
          )}

          {selectedPlanId === 'invictus_performance' && currentPendingVerification && !paymentCheckMsg && (
            <div className="bg-primary/10 border border-primary/20 text-primary rounded-xl p-4 flex gap-3 items-start text-xs leading-relaxed">
              <RefreshCw className="h-4 w-4 shrink-0 mt-0.5" />
              <span>A loja já confirmou a operação. Falta apenas aplicar o benefício no servidor; tentar novamente não abrirá uma nova compra.</span>
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
{selectedPlanId === 'invictus_open'
  ? 'Comece Agora, é Grátis!'
  : currentPendingVerification ? 'CONFIRMAÇÃO PENDENTE' : 'Assinatura In-App Nativa (Google Play / App Store)'}
</span>
<p className="text-[9.5px] text-on-surface-variant leading-relaxed">
{selectedPlanId === 'invictus_open'
? 'Sem custo e sem necessidade de cartão. Ative seu acesso ao Plano Free agora mesmo.'
: currentPendingVerification
  ? 'A compra ou restauração já terminou na loja. Esta etapa consulta somente o servidor e é segura para repetir.'
: nativeStorePlatform
  ? `O preço e o período acima são informados pela ${nativeStoreName}. A loja confirmará a assinatura antes da liberação.`
  : 'A assinatura do Plano Pro está disponível no aplicativo instalado para Android ou iOS.'}
</p>
</div>

{selectedPlanId === 'invictus_open' ? (
<button
onClick={() => void handleOpenActivation()}
disabled={paywallLoading || !verificationHydrated}
className="w-full h-14 bg-primary hover:bg-primary-hover text-white font-headline italic font-black text-sm rounded-xl flex items-center justify-center gap-1.5 transition-all uppercase tracking-wider disabled:opacity-50"
>
{paywallLoading ? (
<Loader2 className="h-4 w-4 animate-spin text-white" />
) : (
<span>Começar Grátis</span>
)}
</button>
) : (
<div className="space-y-3">
<button
onClick={() => void handlePerformanceStoreAction('purchase')}
disabled={paywallLoading || !verificationHydrated || performanceOfferLoading || (!currentPendingVerification && !performanceOffer) || !nativeStorePlatform}
className="w-full h-14 bg-primary hover:bg-primary-hover text-white font-headline italic font-black text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all uppercase tracking-wider disabled:opacity-50"
>
{paywallLoading || performanceOfferLoading ? (
<Loader2 className="h-4 w-4 animate-spin text-white" />
) : (
<span>{currentPendingVerification
  ? 'CONFIRMAR ASSINATURA'
  : nativeStorePlatform ? `Assinar pela ${nativeStoreName}` : 'Disponível no app Android ou iOS'}</span>
)}
</button>

{nativeStorePlatform ? <button
onClick={() => void handlePerformanceStoreAction('restore')}
disabled={paywallLoading || !verificationHydrated}
className="w-full h-12 border border-surface-variant hover:border-primary text-on-surface-variant hover:text-primary font-headline italic font-black rounded-xl text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-50"
>
{paywallLoading && subscriptionAction === 'restore'
  ? <><Loader2 className="h-4 w-4 animate-spin" /> RESTAURANDO…</>
  : <><RefreshCw className="h-4 w-4" /> {currentPendingVerification ? 'REVALIDAR NA LOJA' : 'RESTAURAR COMPRA'}</>}
</button> : null}
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
