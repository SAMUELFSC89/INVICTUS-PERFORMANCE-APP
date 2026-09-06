import { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { CheckCircle2, Crown, Loader2, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { useUser } from '../UserContext';
import {
  getPerformanceSubscriptionOffer,
  purchasePerformanceSubscription,
  restorePerformanceSubscription,
  type PerformanceSubscriptionOffer,
} from '../lib/revenuecat';
import { LEGAL_SUBSCRIPTIONS_POLICY } from '../lib/legalDocuments';
import { hasActiveProEntitlement } from '../lib/proEntitlement';
import {
  clearPendingSubscriptionVerification,
  createPendingSubscriptionVerification,
  isSubscriptionProvisioned,
  isTerminalInactiveSubscription,
  readPendingSubscriptionVerification,
  savePendingSubscriptionVerification,
  type PendingSubscriptionVerification,
  type SubscriptionStoreOperation,
  type SubscriptionStorePlatform,
} from '../lib/subscriptionVerification';

type FlowState = 'idle' | 'purchasing' | 'restoring' | 'verifying';
type OfferState = {
  uid: string;
  status: 'loading' | 'ready' | 'error';
  offer: PerformanceSubscriptionOffer | null;
  error: string;
};

function periodLabel(period: string | null | undefined): string {
  const normalized = String(period || '').toUpperCase();
  if (normalized === 'P1W') return 'por semana';
  if (normalized === 'P1M') return 'por mês';
  if (normalized === 'P3M') return 'a cada 3 meses';
  if (normalized === 'P6M') return 'a cada 6 meses';
  if (normalized === 'P1Y') return 'por ano';
  return 'conforme o período exibido pela loja';
}

function safeReturnPath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/';
}

export function SubscriptionManager() {
  const { user, refreshUser } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [offerState, setOfferState] = useState<OfferState | null>(null);
  const [offerReload, setOfferReload] = useState(0);
  const [pendingVerification, setPendingVerification] = useState<PendingSubscriptionVerification | null>(null);
  const [verificationHydratedUid, setVerificationHydratedUid] = useState<string | null>(null);
  const [state, setState] = useState<FlowState>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const actionInFlight = useRef(false);
  const isNative = Capacitor.isNativePlatform();
  const platformValue = Capacitor.getPlatform();
  const platform: SubscriptionStorePlatform | null = platformValue === 'android' || platformValue === 'ios'
    ? platformValue
    : null;
  const isPro = useMemo(() => hasActiveProEntitlement(user), [user]);
  const currentPending = pendingVerification?.uid === user?.uid ? pendingVerification : null;
  const hydrated = Boolean(user?.uid && verificationHydratedUid === user.uid);
  const currentOfferState = offerState?.uid === user?.uid ? offerState : null;
  const offer = currentOfferState?.status === 'ready' ? currentOfferState.offer : null;
  const offerLoading = Boolean(isNative && user?.uid && hydrated && !isPro && !currentPending && currentOfferState?.status === 'loading');

  useEffect(() => {
    const uid = user?.uid;
    setPendingVerification(null);
    setVerificationHydratedUid(null);
    setOfferState(null);
    setState('idle');
    setError('');
    setNotice('');
    if (!uid) return;
    setPendingVerification(readPendingSubscriptionVerification(uid));
    setVerificationHydratedUid(uid);
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !currentPending || !isPro) return;
    clearPendingSubscriptionVerification(user.uid);
    setPendingVerification(null);
  }, [currentPending, isPro, user?.uid]);

  useEffect(() => {
    let cancelled = false;
    const uid = user?.uid;
    if (!uid || !isNative || !platform || !hydrated || isPro || currentPending) {
      setOfferState(null);
      return () => { cancelled = true; };
    }

    setOfferState({ uid, status: 'loading', offer: null, error: '' });
    getPerformanceSubscriptionOffer(uid)
      .then(nextOffer => {
        if (!cancelled && auth.currentUser?.uid === uid) {
          setOfferState({ uid, status: 'ready', offer: nextOffer, error: '' });
        }
      })
      .catch(reason => {
        if (!cancelled && auth.currentUser?.uid === uid) {
          setOfferState({
            uid,
            status: 'error',
            offer: null,
            error: reason instanceof Error ? reason.message : 'Não foi possível consultar a oferta da loja agora.',
          });
        }
      });
    return () => { cancelled = true; };
  }, [currentPending?.storeCompletedAt, hydrated, isNative, isPro, offerReload, platform, user?.uid]);

  const runAction = async (action: Exclude<FlowState, 'idle'>, uid: string, operation: () => Promise<void>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setState(action);
    setError('');
    setNotice('');
    try {
      if (auth.currentUser?.uid !== uid) throw new Error('A conta mudou. Tente novamente na conta correta.');
      await operation();
    } catch (reason) {
      if (auth.currentUser?.uid === uid) {
        setState('idle');
        setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a assinatura.');
      }
    } finally {
      actionInFlight.current = false;
    }
  };

  const confirmWithServer = async (pending: PendingSubscriptionVerification) => {
    const account = auth.currentUser;
    if (!account || account.uid !== pending.uid) {
      throw new Error('A conta mudou antes da confirmação. Entre na conta que concluiu a operação na loja.');
    }
    const token = await account.getIdToken();
    if (auth.currentUser?.uid !== pending.uid) {
      throw new Error('A conta mudou antes da confirmação. Nenhum benefício foi aplicado à conta incorreta.');
    }

    const response = await fetch('/api/payments/verify-purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        planId: 'invictus_performance',
        platform: pending.platform,
        productId: pending.productIdentifier,
        packageIdentifier: pending.packageIdentifier,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (isTerminalInactiveSubscription(payload) && auth.currentUser?.uid === pending.uid) {
        clearPendingSubscriptionVerification(pending.uid);
        setPendingVerification(null);
      }
      throw new Error(payload.error || 'A compra foi confirmada pela loja, mas o servidor ainda não aplicou o benefício. Tente confirmar novamente.');
    }
    if (!isSubscriptionProvisioned(payload)) {
      throw new Error(payload.error || 'A resposta ainda não confirma que o benefício Pro foi aplicado. Tente confirmar novamente.');
    }

    if (auth.currentUser?.uid !== pending.uid) return;
    const successNotice = pending.operation === 'restore'
      ? 'Compra restaurada e benefícios Pro sincronizados.'
      : 'Assinatura confirmada e benefícios Pro liberados.';
    try {
      const refreshedProfile = await refreshUser?.();
      if (auth.currentUser?.uid === pending.uid && hasActiveProEntitlement(refreshedProfile)) {
        clearPendingSubscriptionVerification(pending.uid);
        setPendingVerification(null);
        setState('idle');
        setNotice(successNotice);
      } else if (auth.currentUser?.uid === pending.uid) {
        setState('idle');
        setNotice('Benefício aplicado pelo servidor. Confirme novamente para sincronizar este dispositivo; nenhuma nova compra será aberta.');
      }
    } catch (refreshError) {
      console.error('[Subscription Manager] Benefício aplicado, mas o perfil não foi recarregado:', refreshError);
      if (auth.currentUser?.uid === pending.uid) {
        setState('idle');
        setNotice('Benefício aplicado pelo servidor. Confirme novamente para sincronizar este dispositivo; nenhuma nova compra será aberta.');
      }
    }
  };

  const verifyPending = async (pending: PendingSubscriptionVerification) => {
    await runAction('verifying', pending.uid, () => confirmWithServer(pending));
  };

  const runStoreOperation = async (operation: SubscriptionStoreOperation) => {
    const uid = user?.uid;
    if (!uid || !platform || !hydrated) return;
    if (currentPending && operation === 'purchase') {
      await verifyPending(currentPending);
      return;
    }
    const selectedOffer = offer;
    if (operation === 'purchase' && !selectedOffer) {
      setError(currentOfferState?.error || 'A oferta da loja ainda não está disponível. Tente novamente.');
      return;
    }

    await runAction(operation === 'purchase' ? 'purchasing' : 'restoring', uid, async () => {
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
      const persisted = savePendingSubscriptionVerification(pending);
      if (auth.currentUser?.uid === uid) setPendingVerification(pending);
      try {
        await confirmWithServer(pending);
      } catch (verificationError) {
        if (!persisted) {
          const message = verificationError instanceof Error ? verificationError.message : 'A confirmação do servidor falhou.';
          throw new Error(`${message} Mantenha esta tela aberta e tente confirmar novamente.`);
        }
        throw verificationError;
      }
    });
  };

  const retry = () => {
    if (currentPending) {
      void verifyPending(currentPending);
      return;
    }
    setError('');
    setOfferReload(value => value + 1);
  };

  const returnToOrigin = () => navigate(safeReturnPath((location.state as any)?.returnTo));
  const busy = state === 'purchasing' || state === 'restoring' || state === 'verifying';
  const showSuccess = isPro;

  return <section className="subscription-manager">
    <article className="subscription-manager-card">
      <span className="subscription-manager-icon"><Crown /></span>
      <small>PLANO PERFORMANCE</small>
      <h2>{showSuccess ? 'PRO ATIVO' : 'EVOLUA PARA O PRO'}</h2>
      <p>Gráficos biométricos avançados, integrações de saúde e recursos de IA. A assinatura não altera pontos nem inscreve você automaticamente em competições.</p>

      {showSuccess ? <div className="subscription-manager-success"><CheckCircle2 /><span>{notice || 'Os benefícios do plano estão disponíveis nesta conta.'}</span></div> : null}
      {currentPending && !showSuccess ? <div className="subscription-manager-info"><RefreshCw /><span>{notice || 'A loja já confirmou a operação. Falta apenas sincronizar o benefício; repetir esta etapa não abre uma nova compra.'}</span></div> : null}
      {!isNative ? <div className="subscription-manager-info"><Smartphone /><span>A compra e a restauração são concluídas com segurança no aplicativo instalado para Android ou iOS.</span></div> : null}

      {offerLoading ? <p className="subscription-manager-loading"><Loader2 /> Consultando a loja…</p> : null}
      {offer ? <div className="subscription-manager-offer">
        <span>Oferta confirmada pela loja</span>
        <b>{offer.priceString}</b>
        <small>{periodLabel(offer.subscriptionPeriod)} · {offer.productIdentifier}</small>
      </div> : null}

      {error || currentOfferState?.error ? <div className="subscription-manager-error" role="alert"><span>{error || currentOfferState?.error}</span><button onClick={retry} disabled={!isNative || busy || !hydrated}><RefreshCw />{currentPending ? 'CONFIRMAR NOVAMENTE' : 'TENTAR NOVAMENTE'}</button></div> : null}

      {isNative && !showSuccess ? <button className="profile-flow-primary" onClick={() => void runStoreOperation('purchase')} disabled={busy || !hydrated || offerLoading || (!currentPending && !offer)}>
        {state === 'purchasing' ? <><Loader2 /> PROCESSANDO NA LOJA…</> : state === 'verifying' ? <><Loader2 /> CONFIRMANDO BENEFÍCIO…</> : currentPending ? 'CONFIRMAR ASSINATURA' : <>ASSINAR {offer ? `· ${offer.priceString}` : ''}</>}
      </button> : null}
      {isNative && !showSuccess ? <button className="subscription-manager-secondary" onClick={() => void runStoreOperation('restore')} disabled={busy || !hydrated}>
        {state === 'restoring' ? <><Loader2 /> RESTAURANDO…</> : <><RefreshCw />{currentPending ? 'REVALIDAR NA LOJA' : 'RESTAURAR COMPRA'}</>}
      </button> : null}
      <button className="subscription-manager-secondary" onClick={returnToOrigin} disabled={busy}>VOLTAR AO APLICATIVO</button>
    </article>

    <details className="subscription-manager-policy">
      <summary><ShieldCheck /> ASSINATURA E CANCELAMENTO</summary>
      {LEGAL_SUBSCRIPTIONS_POLICY.split('\n\n').map((paragraph, index) => <p key={index}>{paragraph.replace(/^#+\s*/, '')}</p>)}
    </details>
  </section>;
}
