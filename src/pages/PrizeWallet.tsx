import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trophy,
  UserRound,
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
    cpfVerified: boolean;
    ready: boolean;
    phone?: string;
  };
  cashSource: 'official_prizes_only';
  coinsWithdrawable: false;
};

type OtpState = {
  requestId: string;
  phone: string;
  expiresAt?: string;
  message?: string;
} | null;

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
  const [otp, setOtp] = useState<OtpState>(null);
  const [otpCode, setOtpCode] = useState('');

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
  const canRequest = Boolean(
    data?.config.enabled
    && identityReady
    && !otp
    && Number.isFinite(requestedAmount)
    && requestedAmount >= minWithdrawal
    && requestedAmount <= Math.min(available, maxDaily)
    && pixKey.trim(),
  );

  const orderedWithdrawals = useMemo(() => [...(data?.withdrawals || [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [data?.withdrawals]);

  const requestWithdrawal = async () => {
    if (!canRequest || submitting) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const result = await authenticatedFetch('/api/financial', {
        method: 'POST',
        body: JSON.stringify({
          action: 'request-withdrawal',
          amount: requestedAmount,
          pixKey: pixKey.trim(),
          pixKeyType,
        }),
      });
      if (!result.otpRequired || !result.otpRequestId) {
        throw new Error('O servidor não abriu a confirmação por código para o saque.');
      }
      setOtp({
        requestId: result.otpRequestId,
        phone: result.phone || data?.identity?.phone || '',
        expiresAt: result.expiresAt,
        message: result.userMessage,
      });
      setOtpCode('');
      setNotice(result.userMessage || 'Enviamos um código de confirmação por SMS.');
    } catch (reason: any) {
      if (reason?.code === 'IDENTITY_VERIFICATION_REQUIRED') {
        setError('Sua conta ainda precisa confirmar e-mail, telefone e CPF antes do saque.');
        await load();
      } else {
        setError(reason?.message || 'Não foi possível iniciar o saque.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const confirmOtp = async () => {
    if (!otp || otpCode.length < 4 || submitting) return;
    setSubmitting(true); setError(''); setNotice('');
    try {
      const result = await authenticatedFetch('/api/financial', {
        method: 'POST',
        body: JSON.stringify({ action: 'confirm-withdrawal-otp', otpRequestId: otp.requestId, code: otpCode }),
      });
      setOtp(null); setOtpCode(''); setAmount('');
      setNotice(result.userMessage || 'Solicitação de saque criada. O valor ficou reservado para processamento do PIX.');
      await load();
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível confirmar o código do saque.');
    } finally { setSubmitting(false); }
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

      <section className="prize-wallet-separation"><ShieldCheck /><div><b>{identityReady ? 'CONTA VERIFICADA PARA SAQUE' : 'CONFIRME SUA IDENTIDADE'}</b><p>E-mail {identity?.emailVerified ? '✓' : 'pendente'} · telefone {identity?.phoneVerified ? '✓' : 'pendente'} · CPF/Receita {identity?.cpfVerified ? '✓' : 'pendente'}.</p>{!identityReady ? <button type="button" className="prize-wallet-submit" onClick={() => navigate('/profile/identity')}>VERIFICAR MINHA CONTA</button> : null}</div></section>

      <section className="prize-wallet-withdrawal">
        <header><div><small>SAQUE DE PRÊMIO</small><h2>RECEBER POR PIX</h2></div><Banknote /></header>
        {!data?.config.enabled ? <div className="prize-wallet-disabled">Saques temporariamente indisponíveis.</div> : <>
          <div className="prize-wallet-limits"><span>Mínimo <b>{money(minWithdrawal)}</b></span><span>Limite diário <b>{money(maxDaily)}</b></span></div>
          <label>VALOR A SACAR
            <div className="prize-wallet-money-input"><span>R$</span><input inputMode="decimal" value={amount} disabled={Boolean(otp)} onChange={event => setAmount(event.target.value.replace(/[^0-9,.]/g, ''))} placeholder={minWithdrawal.toFixed(2).replace('.', ',')} /></div>
          </label>
          <div className="prize-wallet-pix-grid">
            <label>TIPO DE CHAVE
              <select value={pixKeyType} disabled={Boolean(otp)} onChange={event => setPixKeyType(event.target.value as typeof pixKeyType)}>
                <option value="cpf">CPF</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="random">Chave aleatória</option>
              </select>
            </label>
            <label>CHAVE PIX<input value={pixKey} disabled={Boolean(otp)} onChange={event => setPixKey(event.target.value)} autoComplete="off" placeholder="Digite sua chave PIX" /></label>
          </div>

          {!otp ? <>
            <p className="prize-wallet-biometric"><Smartphone /> Cada saque exige um novo código de uso único enviado por SMS ao telefone verificado da sua conta. Não usamos selfie para liberar PIX.</p>
            <button type="button" className="prize-wallet-submit" disabled={!canRequest || submitting} onClick={() => void requestWithdrawal()}>{submitting ? <><Loader2 className="is-spinning" /> ENVIANDO CÓDIGO</> : <><MessageSquareText /> RECEBER CÓDIGO POR SMS</>}</button>
          </> : <div className="prize-wallet-pix-grid">
            <label>CÓDIGO ENVIADO PARA {otp.phone || 'SEU TELEFONE'}<input value={otpCode} onChange={event => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" /></label>
            <div><button type="button" className="prize-wallet-submit" disabled={otpCode.length < 4 || submitting} onClick={() => void confirmOtp()}>{submitting ? <><Loader2 className="is-spinning" /> CONFIRMANDO</> : <><ShieldCheck /> CONFIRMAR SAQUE</>}</button><button type="button" className="prize-wallet-submit" disabled={submitting} onClick={() => { setOtp(null); setOtpCode(''); setNotice(''); }}>CANCELAR CÓDIGO</button></div>
          </div>}
          {available < minWithdrawal ? <p className="prize-wallet-hint">Você poderá solicitar o PIX quando tiver pelo menos {money(minWithdrawal)} em prêmios disponíveis.</p> : null}
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
  </div>

  <nav className="prize-wallet-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button className="is-active" onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav>
  </main>, document.body);
}
