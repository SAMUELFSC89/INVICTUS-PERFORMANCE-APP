import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Fingerprint, Loader2, MailCheck, MessageSquareText, RefreshCw, ShieldCheck, Smartphone, UserCheck } from 'lucide-react';
import { auth, sendEmailVerification } from '../firebase';
import { useUser } from '../UserContext';
import { InvictusLogo } from '../components/InvictusLogo';
import './IdentityVerification.css';

type IdentityStatus = {
  email: { value: string; verified: boolean; verifiedAt?: unknown };
  phone: { value: string; verified: boolean; verifiedAt?: unknown };
  cpf: { value: string; verified: boolean; verifiedAt?: unknown; status?: string; provider?: string | null };
};

type IdentityPayload = {
  success: boolean;
  identity: IdentityStatus;
  providers?: { sms?: boolean; cpf?: boolean };
};

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
  if (!response.ok || payload?.success === false) throw new Error(payload?.error || payload?.userMessage || 'Não foi possível concluir a verificação.');
  return payload;
}

export function IdentityVerification() {
  const navigate = useNavigate();
  const { user, refreshUser } = useUser();
  const [data, setData] = useState<IdentityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [phone, setPhone] = useState(String((user as any)?.phoneNumber || (user as any)?.phone || ''));
  const [code, setCode] = useState('');
  const [phoneStep, setPhoneStep] = useState<'idle' | 'code'>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const payload = await authenticatedFetch('/api/identity-verification');
      setData(payload as IdentityPayload);
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível consultar o status da conta.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (name: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(name); setError(''); setNotice('');
    try { await work(); } catch (reason: any) { setError(reason?.message || 'Não foi possível concluir a operação.'); } finally { setBusy(''); }
  };

  const resendEmail = () => run('email', async () => {
    const current = auth.currentUser;
    if (!current) throw new Error('Sua sessão expirou. Entre novamente.');
    if (current.emailVerified) {
      await authenticatedFetch('/api/identity-verification', { method: 'POST', body: JSON.stringify({ action: 'sync-email' }) });
      setNotice('Seu e-mail já está confirmado.');
      await load();
      return;
    }
    auth.languageCode = 'pt-BR';
    await sendEmailVerification(current, {
      url: 'https://invictusperformance.app.br/profile/identity',
      handleCodeInApp: false,
    });
    setNotice('Enviamos um novo e-mail de verificação da Invictus. Abra a mensagem e confirme seu endereço.');
  });

  const syncEmail = () => run('sync-email', async () => {
    await auth.currentUser?.reload();
    await auth.currentUser?.getIdToken(true);
    const result = await authenticatedFetch('/api/identity-verification', { method: 'POST', body: JSON.stringify({ action: 'sync-email' }) });
    setNotice(result.userMessage || 'Status do e-mail atualizado.');
    await load();
  });

  const startPhone = () => run('phone-start', async () => {
    const result = await authenticatedFetch('/api/identity-verification', {
      method: 'POST',
      body: JSON.stringify({ action: 'start-phone', phoneNumber: phone }),
    });
    setPhoneStep('code'); setCode('');
    setNotice(result.userMessage || 'Código enviado por SMS.');
  });

  const confirmPhone = () => run('phone-confirm', async () => {
    const result = await authenticatedFetch('/api/identity-verification', {
      method: 'POST',
      body: JSON.stringify({ action: 'confirm-phone', phoneNumber: phone, code }),
    });
    setPhoneStep('idle'); setCode('');
    setNotice(result.userMessage || 'Telefone confirmado.');
    await refreshUser?.();
    await load();
  });

  const verifyCpf = () => run('cpf', async () => {
    const result = await authenticatedFetch('/api/identity-verification', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify-cpf' }),
    });
    setNotice(result.userMessage || 'CPF confirmado.');
    await refreshUser?.();
    await load();
  });

  const identity = data?.identity;
  const complete = Boolean(identity?.email.verified && identity?.phone.verified && identity?.cpf.verified);

  const status = (verified?: boolean) => verified
    ? <span className="identity-status is-ok"><CheckCircle2 /> CONFIRMADO</span>
    : <span className="identity-status"><RefreshCw /> PENDENTE</span>;

  return createPortal(<main className="identity-screen"><div className="identity-page">
    <header className="identity-header"><button onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft /></button><div><InvictusLogo size={40}/><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div><span /></header>
    <section className="identity-title"><small>SEGURANÇA DA CONTA</small><h1>IDENTIDADE <span>VERIFICADA</span></h1><p>E-mail, telefone e CPF são confirmados por canais independentes antes de operações financeiras.</p></section>

    {error ? <div className="identity-alert is-error">{error}</div> : null}
    {notice ? <div className="identity-alert is-success">{notice}</div> : null}
    {loading && !data ? <div className="identity-loading"><Loader2 className="is-spinning"/> CONSULTANDO CONTA</div> : <>
      <section className={complete ? 'identity-complete is-ok' : 'identity-complete'}><ShieldCheck/><div><b>{complete ? 'CONTA VERIFICADA' : 'VERIFICAÇÃO PENDENTE'}</b><p>{complete ? 'Os três fatores de identidade estão confirmados.' : 'Conclua os itens abaixo. O saque fica protegido até todos estarem verificados.'}</p></div></section>

      <section className="identity-card"><header><MailCheck/><div><small>E-MAIL</small><h2>{identity?.email.value || auth.currentUser?.email || 'E-mail da conta'}</h2></div>{status(identity?.email.verified)}</header>{!identity?.email.verified ? <div className="identity-actions"><button disabled={Boolean(busy)} onClick={() => void resendEmail()}>{busy === 'email' ? <Loader2 className="is-spinning"/> : <MessageSquareText/>} ENVIAR E-MAIL INVICTUS</button><button className="is-secondary" disabled={Boolean(busy)} onClick={() => void syncEmail()}>JÁ CONFIRMEI</button></div> : <p>Endereço confirmado pelo Firebase Authentication.</p>}</section>

      <section className="identity-card"><header><Smartphone/><div><small>TELEFONE</small><h2>{identity?.phone.value || 'Confirme seu celular'}</h2></div>{status(identity?.phone.verified)}</header>{!identity?.phone.verified ? <div className="identity-form"><label>CELULAR COM DDD<input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" placeholder="(51) 99999-9999" /></label>{phoneStep === 'code' ? <label>CÓDIGO RECEBIDO<input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" /></label> : null}<div className="identity-actions">{phoneStep === 'code' ? <><button disabled={Boolean(busy) || code.length < 4} onClick={() => void confirmPhone()}>{busy === 'phone-confirm' ? <Loader2 className="is-spinning"/> : <UserCheck/>} CONFIRMAR CÓDIGO</button><button className="is-secondary" disabled={Boolean(busy)} onClick={() => void startPhone()}>REENVIAR SMS</button></> : <button disabled={Boolean(busy) || phone.replace(/\D/g, '').length < 10} onClick={() => void startPhone()}>{busy === 'phone-start' ? <Loader2 className="is-spinning"/> : <MessageSquareText/>} ENVIAR SMS INVICTUS</button>}</div></div> : <p>Número confirmado por código de uso único (OTP).</p>}</section>

      <section className="identity-card"><header><Fingerprint/><div><small>CPF</small><h2>{identity?.cpf.value || 'CPF cadastrado'}</h2></div>{status(identity?.cpf.verified)}</header>{identity?.cpf.status ? <p>Situação retornada: <b>{identity.cpf.status}</b></p> : null}{!identity?.cpf.verified ? <div className="identity-actions"><button disabled={Boolean(busy) || data?.providers?.cpf === false} onClick={() => void verifyCpf()}>{busy === 'cpf' ? <Loader2 className="is-spinning"/> : <UserCheck/>} CONFIRMAR NA RECEITA FEDERAL</button></div> : <p>CPF e data de nascimento conferidos via Consulta CPF do Serpro/Receita Federal.</p>}{data?.providers?.cpf === false && !identity?.cpf.verified ? <small className="identity-provider-note">A integração oficial ainda precisa das credenciais do Serpro no ambiente de produção.</small> : null}</section>
    </>}
  </div></main>, document.body);
}
