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
  Plus,
  RefreshCw,
  ShieldCheck,
  Trophy,
  UserRound,
  XCircle,
} from 'lucide-react';
import { auth } from '../firebase';
import { InvictusLogo } from '../components/InvictusLogo';
import { VerifiedPresenceModal } from '../components/VerifiedPresenceModal';
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
  cashSource: 'official_prizes_only';
  coinsWithdrawable: false;
};

type PresenceState = {
  id: string;
  prompt: string;
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
  const token = await currentUser.getIdToken();
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
    throw new Error(payload?.error || payload?.userMessage || 'Não foi possível concluir a operação.');
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
  const [presence, setPresence] = useState<PresenceState>(null);

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
  const canRequest = Boolean(
    data?.config.enabled
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
      if (!result.presenceCheckRequired || !result.presenceCheckId) {
        throw new Error('O servidor não abriu a confirmação de identidade para o saque.');
      }
      setPresence({
        id: result.presenceCheckId,
        prompt: result.livenessPrompt || 'Siga o gesto indicado',
        message: result.userMessage,
      });
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível iniciar o saque.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePresenceSuccess = async (result: { status: string; userMessage: string; commitResult?: any }) => {
    setPresence(null);
    if (result.status !== 'approved' || !result.commitResult) {
      setError(result.userMessage || 'A confirmação de identidade não foi aprovada.');
      return;
    }
    setNotice('Solicitação de saque criada. O valor ficou reservado até a análise e envio do PIX.');
    setAmount('');
    await load();
  };

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

      <section className="prize-wallet-withdrawal">
        <header><div><small>SAQUE DE PRÊMIO</small><h2>RECEBER POR PIX</h2></div><Banknote /></header>
        {!data?.config.enabled ? <div className="prize-wallet-disabled">Saques temporariamente indisponíveis.</div> : <>
          <div className="prize-wallet-limits"><span>Mínimo <b>{money(minWithdrawal)}</b></span><span>Limite diário <b>{money(maxDaily)}</b></span></div>
          <label>VALOR A SACAR
            <div className="prize-wallet-money-input"><span>R$</span><input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value.replace(/[^0-9,.]/g, ''))} placeholder={minWithdrawal.toFixed(2).replace('.', ',')} /></div>
          </label>
          <div className="prize-wallet-pix-grid">
            <label>TIPO DE CHAVE
              <select value={pixKeyType} onChange={event => setPixKeyType(event.target.value as typeof pixKeyType)}>
                <option value="cpf">CPF</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="random">Chave aleatória</option>
              </select>
            </label>
            <label>CHAVE PIX<input value={pixKey} onChange={event => setPixKey(event.target.value)} autoComplete="off" placeholder="Digite sua chave PIX" /></label>
          </div>
          <p className="prize-wallet-biometric"><ShieldCheck /> Por segurança, cada solicitação exige uma confirmação facial ao vivo antes de reservar o saldo.</p>
          <button type="button" className="prize-wallet-submit" disabled={!canRequest || submitting} onClick={() => void requestWithdrawal()}>{submitting ? <><Loader2 className="is-spinning" /> PREPARANDO VALIDAÇÃO</> : <><Banknote /> SOLICITAR SAQUE VIA PIX</>}</button>
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

  <VerifiedPresenceModal
    isOpen={Boolean(presence)}
    presenceCheckId={presence?.id || ''}
    livenessPrompt={presence?.prompt || ''}
    userMessage={presence?.message}
    onClose={() => setPresence(null)}
    onSuccess={result => void handlePresenceSuccess(result)}
  />
  </main>, document.body);
}
