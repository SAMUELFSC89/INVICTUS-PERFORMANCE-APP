import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { reauthenticateWithPhoneNumber, RecaptchaVerifier, type ConfirmationResult } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trophy,
  XCircle,
} from 'lucide-react';
import { auth } from '../firebase';
import { InvictusLogo } from '../components/InvictusLogo';
import type { PIXWithdrawal, WithdrawalStatus } from '../types';
import './PrizeWallet.css';

type WalletPayload = {
  success: boolean;
  wallet: {
    redeemableBalance: number;
    blockedBalance: number;
    updatedAt?: string;
  };
  withdrawals: PIXWithdrawal[];
  config: {
    enabled: boolean;
    minWithdrawalAmount: number;
    maxDailyWithdrawalAmount: number;
  };
  identity?: {
    emailVerified: boolean;
    phoneVerified: boolean;
    ready: boolean;
    phone?: string;
  };
  cashSource: 'official_prizes_only';
  coinsWithdrawable: false;
};

const STATUS_META: Record<WithdrawalStatus, { label: string; icon: typeof Clock3 }> = {
  pending: { label: 'Solicitado', icon: Clock3 },
  under_review: { label: 'Em análise', icon: ShieldCheck },
  approved: { label: 'Aprovado', icon: CheckCircle2 },
  processing: { label: 'Processando PIX', icon: RefreshCw },
  paid: { label: 'Pago', icon: CheckCircle2 },
  cancelled: { label: 'Cancelado', icon: XCircle },
  rejected: { label: 'Recusado', icon: XCircle },
};

function money(value: unknown): string {
  return (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR') : '—';
}

function firebasePhoneError(reason: any): string {
  const code = String(reason?.code || '');
  if (code.includes('invalid-verification-code')) return 'Código incorreto. Confira o SMS e tente novamente.';
  if (code.includes('code-expired')) return 'O código expirou. Solicite um novo SMS.';
  if (code.includes('too-many-requests')) return 'Muitas tentativas de SMS. Aguarde um pouco e tente novamente.';
  if (code.includes('quota-exceeded')) return 'O limite temporário de SMS do Firebase foi atingido. Tente novamente mais tarde.';
  if (code.includes('captcha-check-failed')) return 'A proteção antiabuso do Firebase não foi concluída. Tente novamente.';
  return reason?.message || 'Não foi possível confirmar o telefone.';
}

async function authenticatedFetch(path: string, init?: RequestInit) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Sua sessão expirou. Entre novamente.');
  const token = await currentUser.getIdToken(true);
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const error: any = new Error(payload?.error || payload?.userMessage || 'Não foi possível concluir a operação.');
    error.code = payload?.code;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function newWithdrawalRequestId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
  return `wdr_${random}`;
}

export function PrizeWallet() {
  const navigate = useNavigate();
  const [data, setData] = useState<WalletPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [amount, setAmount] = useState('');
  const [pixKeyType, setPixKeyType] = useState<'cpf' | 'email' | 'phone' | 'random'>('email');
  const [pixKey, setPixKey] = useState(auth.currentUser?.email || '');
  const [phoneChallenge, setPhoneChallenge] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  const clearPhoneChallenge = useCallback(() => {
    try { recaptchaRef.current?.clear(); } catch { /* best effort */ }
    recaptchaRef.current = null;
    confirmationRef.current = null;
    setPhoneChallenge(false);
    setOtpCode('');
  }, []);

  useEffect(() => () => {
    try { recaptchaRef.current?.clear(); } catch { /* best effort */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await authenticatedFetch('/api/financial');
      setData(payload as WalletPayload);
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível carregar seus prêmios.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const available = Number(data?.wallet.redeemableBalance || 0);
  const blocked = Number(data?.wallet.blockedBalance || 0);
  const minWithdrawal = Number(data?.config.minWithdrawalAmount || 20);
  const maxDaily = Number(data?.config.maxDailyWithdrawalAmount || 1000);
  const requestedAmount = Number(String(amount).replace(',', '.'));
  const identityReady = data?.identity?.ready === true;
  const withdrawalInputValid = Boolean(
    data?.config.enabled
    && identityReady
    && Number.isFinite(requestedAmount)
    && requestedAmount >= minWithdrawal
    && requestedAmount <= Math.min(available, maxDaily)
    && pixKey.trim(),
  );
  const canRequest = withdrawalInputValid && !phoneChallenge;

  const orderedWithdrawals = useMemo(() => [...(data?.withdrawals || [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [data?.withdrawals]);

  const startPhoneReauth = async () => {
    if (!withdrawalInputValid || submitting) return;
    const current = auth.currentUser;
    if (!current?.phoneNumber) {
      setError('Confirme um telefone na sua conta antes de solicitar o saque.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      try { recaptchaRef.current?.clear(); } catch { /* best effort */ }
      auth.languageCode = 'pt-BR';
      const verifier = new RecaptchaVerifier(auth, 'invictus-withdrawal-recaptcha', { size: 'invisible' });
      recaptchaRef.current = verifier;
      confirmationRef.current = await reauthenticateWithPhoneNumber(current, current.phoneNumber, verifier);
      setPhoneChallenge(true);
      setOtpCode('');
      setNotice('O Firebase enviou um código por SMS ao telefone verificado da sua conta.');
    } catch (reason: any) {
      try { recaptchaRef.current?.clear(); } catch { /* best effort */ }
      recaptchaRef.current = null;
      confirmationRef.current = null;
      setError(firebasePhoneError(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const resendPhoneCode = async () => {
    clearPhoneChallenge();
    await startPhoneReauth();
  };

  const confirmPhoneAndWithdraw = async () => {
    if (!phoneChallenge || !confirmationRef.current || otpCode.length < 4 || submitting) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await confirmationRef.current.confirm(otpCode);
      await auth.currentUser?.getIdToken(true);

      const result = await authenticatedFetch('/api/financial', {
        method: 'POST',
        body: JSON.stringify({
          action: 'request-withdrawal',
          amount: requestedAmount,
          pixKey: pixKey.trim(),
          pixKeyType,
          requestId: newWithdrawalRequestId(),
        }),
      });

      clearPhoneChallenge();
      setAmount('');
      setNotice(result.userMessage || 'Solicitação de saque criada. O valor ficou reservado para processamento do PIX.');
      await load();
    } catch (reason: any) {
      if (reason?.code === 'IDENTITY_VERIFICATION_REQUIRED') {
        setError('Sua conta ainda precisa confirmar e-mail e telefone antes do saque.');
        clearPhoneChallenge();
        await load();
      } else if (reason?.code === 'PHONE_REAUTH_REQUIRED') {
        setError('A confirmação por telefone expirou. Solicite um novo código por SMS.');
        clearPhoneChallenge();
      } else {
        setError(firebasePhoneError(reason));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const identity = data?.identity;

  return createPortal(<main className="prize-wallet-screen"><div className="prize-wallet-page">
    <header className="prize-wallet-header">
      <button type="button" onClick={() => navigate('/profile')} aria-label="Voltar ao perfil"><ArrowLeft /></button>
      <div><InvictusLogo size={40} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div>
      <button type="button" onClick={() => void load()} aria-label="Atualizar carteira" disabled={loading}><RefreshCw className={loading ? 'is-spinning' : ''} /></button>
    </header>

    <section className="prize-wallet-title"><small>PREMIAÇÕES OFICIAIS</small><h1>CARTEIRA DE <span>PRÊMIOS</span></h1><p>Somente valores em reais recebidos em premiações elegíveis aparecem aqui.</p></section>

    {error ? <div className="prize-wallet-alert is-error"><AlertTriangle /> <span>{error}</span></div> : null}
    {notice ? <div className="prize-wallet-alert is-success"><CheckCircle2 /> <span>{notice}</span></div> : null}

    {loading && !data ? <section className="prize-wallet-loading"><Loader2 /> CARREGANDO CARTEIRA</section> : <>
      <section className="prize-wallet-balance" aria-label="Saldo de premiações">
        <div><small>SALDO DISPONÍVEL PARA PIX</small><strong>{money(available)}</strong><span><Trophy /> Prêmios homologados</span></div>
        <aside><small>EM PROCESSAMENTO</small><b>{money(blocked)}</b><span>Reservado em solicitações abertas</span></aside>
      </section>

      <section className="prize-wallet-separation"><ShieldCheck /><div><b>INVICTUS COINS NÃO SÃO DINHEIRO</b><p>Coins continuam sendo pontos internos do ecossistema e nunca entram neste saldo nem podem ser sacadas.</p></div></section>

      <section className="prize-wallet-separation"><ShieldCheck /><div><b>{identityReady ? 'CONTA VERIFICADA PARA SAQUE' : 'CONFIRME SUA IDENTIDADE'}</b><p>E-mail {identity?.emailVerified ? '✓' : 'pendente'} · telefone {identity?.phoneVerified ? '✓' : 'pendente'}.</p>{!identityReady ? <button type="button" className="prize-wallet-submit" onClick={() => navigate('/profile/identity')}>VERIFICAR MINHA CONTA</button> : null}</div></section>

      <section className="prize-wallet-withdrawal">
        <header><div><small>SAQUE DE PRÊMIO</small><h2>RECEBER POR PIX</h2></div><Banknote /></header>
        {!data?.config.enabled ? <div className="prize-wallet-disabled">Saques temporariamente indisponíveis.</div> : <>
          <div className="prize-wallet-limits"><span>Mínimo <b>{money(minWithdrawal)}</b></span><span>Limite diário <b>{money(maxDaily)}</b></span></div>
          <label>VALOR A SACAR
            <div className="prize-wallet-money-input"><span>R$</span><input inputMode="decimal" value={amount} disabled={phoneChallenge} onChange={event => setAmount(event.target.value.replace(/[^0-9,.]/g, ''))} placeholder={minWithdrawal.toFixed(2).replace('.', ',')} /></div>
          </label>
          <div className="prize-wallet-pix-grid">
            <label>TIPO DE CHAVE
              <select value={pixKeyType} disabled={phoneChallenge} onChange={event => setPixKeyType(event.target.value as typeof pixKeyType)}>
                <option value="cpf">CPF</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="random">Chave aleatória</option>
              </select>
            </label>
            <label>CHAVE PIX<input value={pixKey} disabled={phoneChallenge} onChange={event => setPixKey(event.target.value)} autoComplete="off" placeholder="Digite sua chave PIX" /></label>
          </div>

          {!phoneChallenge ? <>
            <p className="prize-wallet-biometric"><Smartphone /> Cada saque exige uma nova confirmação por SMS do Firebase no telefone verificado da conta. Não usamos selfie para liberar PIX.</p>
            <button type="button" className="prize-wallet-submit" disabled={!canRequest || submitting} onClick={() => void startPhoneReauth()}>{submitting ? <><Loader2 className="is-spinning" /> ENVIANDO CÓDIGO</> : <><MessageSquareText /> RECEBER CÓDIGO POR SMS</>}</button>
          </> : <div className="prize-wallet-pix-grid">
            <label>CÓDIGO ENVIADO PARA {identity?.phone || 'SEU TELEFONE'}<input value={otpCode} onChange={event => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" /></label>
            <div><button type="button" className="prize-wallet-submit" disabled={otpCode.length < 4 || submitting} onClick={() => void confirmPhoneAndWithdraw()}>{submitting ? <><Loader2 className="is-spinning" /> CONFIRMANDO</> : <><ShieldCheck /> CONFIRMAR E SOLICITAR PIX</>}</button><button type="button" className="prize-wallet-submit" disabled={submitting} onClick={() => clearPhoneChallenge()}>CANCELAR CÓDIGO</button><button type="button" className="prize-wallet-submit" disabled={submitting} onClick={() => void resendPhoneCode()}>REENVIAR SMS</button></div>
          </div>}
          {available < minWithdrawal ? <p className="prize-wallet-hint">Você poderá solicitar o PIX quando tiver pelo menos {money(minWithdrawal)} em prêmios disponíveis.</p> : null}
          <div id="invictus-withdrawal-recaptcha" aria-hidden="true" />
        </>}
      </section>

      <section className="prize-wallet-history">
        <div className="prize-wallet-section-head"><div><small>HISTÓRICO</small><h2>SAQUES</h2></div><span>{orderedWithdrawals.length}</span></div>
        {orderedWithdrawals.length === 0 ? <div className="prize-wallet-empty"><Clock3 /><b>NENHUM SAQUE AINDA</b><p>Quando você solicitar um prêmio por PIX, o andamento aparecerá aqui.</p></div> : <div className="prize-wallet-list">{orderedWithdrawals.map(item => {
          const meta = STATUS_META[item.status] || STATUS_META.pending;
          const Icon = meta.icon;
          return <article key={item.id} className={`status-${item.status}`}><span className="prize-wallet-status-icon"><Icon /></span><div><b>{money(item.amount)}</b><small>{meta.label}</small><p>{formatDate(item.createdAt)}</p></div><span className="prize-wallet-key">PIX<br/><b>{item.pixKeyType?.toUpperCase()}</b></span></article>;
        })}</div>}
      </section>
    </>}
  </div></main>, document.body);
}
