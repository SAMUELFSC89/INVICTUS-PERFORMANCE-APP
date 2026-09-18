import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  linkWithCredential,
  PhoneAuthProvider,
  RecaptchaVerifier,
  updatePhoneNumber,
} from 'firebase/auth';
import { ArrowLeft, CheckCircle2, Loader2, MailCheck, MessageSquareText, RefreshCw, ShieldCheck, Smartphone, UserCheck } from 'lucide-react';
import { auth } from '../firebase';
import { useUser } from '../UserContext';
import { InvictusLogo } from '../components/InvictusLogo';
import './IdentityVerification.css';

type IdentityStatus = {
  email: { value: string; verified: boolean; verifiedAt?: unknown };
  phone: { value: string; verified: boolean; verifiedAt?: unknown };
};

type IdentityPayload = {
  success: boolean;
  identity: IdentityStatus;
};

function normalizeBrazilPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  throw new Error('Informe um telefone brasileiro válido com DDD.');
}

// reason?.code só existe em erros vindos do SDK do Firebase (ex.: "auth/
// internal-error") -- nesse caso NUNCA repassamos reason?.message ao
// usuário, porque é a string bruta do SDK (ex.: "Firebase: Error
// (auth/internal-error).") e não diz nada útil para quem não é dev; mapeamos
// para uma frase genérica e amigável, e o código técnico só fica no console
// para depuração. Quando não há reason?.code, o erro foi lançado por nós
// mesmos (ex.: authenticatedFetch, validação de telefone) e reason?.message
// já é uma frase pronta para o usuário -- essa a gente mantém.
function friendlyPhoneError(reason: any): string {
  const code = String(reason?.code || '');
  if (!code.startsWith('auth/')) return reason?.message || 'Não foi possível concluir a confirmação agora. Tente novamente em instantes.';

  console.warn('[IdentityVerification] Falha na confirmação de telefone:', code);
  if (code.includes('invalid-phone-number')) return 'Número de telefone inválido. Confira o DDD e tente novamente.';
  if (code.includes('credential-already-in-use')) return 'Este telefone já está vinculado a outra conta.';
  if (code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde um pouco e tente novamente.';
  if (code.includes('quota-exceeded')) return 'Limite temporário de envios atingido. Tente novamente mais tarde.';
  if (code.includes('captcha-check-failed') || code.includes('internal-error') || code.includes('invalid-app-credential')) {
    return 'Não foi possível confirmar seu telefone agora. Feche e abra o app novamente e tente de novo em instantes.';
  }
  if (code.includes('invalid-verification-code')) return 'Código incorreto. Confira a mensagem recebida e tente novamente.';
  if (code.includes('code-expired')) return 'O código expirou. Solicite um novo.';
  return 'Não foi possível concluir a confirmação agora. Tente novamente em instantes.';
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
  if (!response.ok || payload?.success === false) throw new Error(payload?.error || payload?.userMessage || 'Não foi possível concluir a verificação.');
  return payload;
}

export function IdentityVerification() {
  const navigate = useNavigate();
  const { user, refreshUser } = useUser();
  const [data, setData] = useState<IdentityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [phone, setPhone] = useState(String(auth.currentUser?.phoneNumber || (user as any)?.phoneNumber || (user as any)?.phone || ''));
  const [code, setCode] = useState('');
  const [phoneStep, setPhoneStep] = useState<'idle' | 'code'>('idle');
  const [verificationId, setVerificationId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  const clearRecaptcha = useCallback(() => {
    try { recaptchaRef.current?.clear(); } catch { /* best effort */ }
    recaptchaRef.current = null;
  }, []);

  useEffect(() => () => clearRecaptcha(), [clearRecaptcha]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const payload = await authenticatedFetch('/api/identity-verification');
      setData(payload as IdentityPayload);
      if (auth.currentUser?.phoneNumber) setPhone(auth.currentUser.phoneNumber);
    } catch (reason: any) {
      setError(reason?.message || 'Não foi possível consultar o status da conta.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (name: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(name); setError(''); setNotice('');
    try { await work(); } catch (reason: any) { setError(friendlyPhoneError(reason)); } finally { setBusy(''); }
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
    // E-mail customizado com a marca Invictus, enviado pelo backend via SMTP
    // da Zoho -- o editor de modelos do Firebase Auth está bloqueado para
    // este projeto, então o envio deixou de ser feito pelo SDK do cliente.
    const result = await authenticatedFetch('/api/identity-verification', { method: 'POST', body: JSON.stringify({ action: 'send-verification-email' }) });
    setNotice(result.userMessage || 'Enviamos um novo e-mail de verificação da Invictus. Abra a mensagem e confirme seu endereço.');
  });

  const syncEmail = () => run('sync-email', async () => {
    await auth.currentUser?.reload();
    await auth.currentUser?.getIdToken(true);
    const result = await authenticatedFetch('/api/identity-verification', { method: 'POST', body: JSON.stringify({ action: 'sync-email' }) });
    setNotice(result.userMessage || 'Status do e-mail atualizado.');
    await load();
  });

  const startPhone = () => run('phone-start', async () => {
    const current = auth.currentUser;
    if (!current) throw new Error('Sua sessão expirou. Entre novamente.');
    const normalizedPhone = normalizeBrazilPhone(phone);

    if (current.phoneNumber && normalizeBrazilPhone(current.phoneNumber) === normalizedPhone) {
      const result = await authenticatedFetch('/api/identity-verification', {
        method: 'POST',
        body: JSON.stringify({ action: 'sync-phone' }),
      });
      setNotice(result.userMessage || 'Telefone já confirmado.');
      await refreshUser?.();
      await load();
      return;
    }

    clearRecaptcha();
    auth.languageCode = 'pt-BR';
    const verifier = new RecaptchaVerifier(auth, 'invictus-phone-recaptcha', {
      size: 'invisible',
    });
    recaptchaRef.current = verifier;
    const provider = new PhoneAuthProvider(auth);
    const id = await provider.verifyPhoneNumber(normalizedPhone, verifier);
    setVerificationId(id);
    setPhone(normalizedPhone);
    setPhoneStep('code');
    setCode('');
    setNotice('Enviamos um código por SMS. Digite o código para confirmar seu telefone.');
  });

  const confirmPhone = () => run('phone-confirm', async () => {
    const current = auth.currentUser;
    if (!current) throw new Error('Sua sessão expirou. Entre novamente.');
    if (!verificationId) throw new Error('Solicite um novo código por SMS.');

    const credential = PhoneAuthProvider.credential(verificationId, code);
    if (current.phoneNumber) {
      await updatePhoneNumber(current, credential);
    } else {
      await linkWithCredential(current, credential);
    }
    await current.reload();
    await current.getIdToken(true);

    const result = await authenticatedFetch('/api/identity-verification', {
      method: 'POST',
      body: JSON.stringify({ action: 'sync-phone' }),
    });
    clearRecaptcha();
    setVerificationId('');
    setPhoneStep('idle');
    setCode('');
    setNotice(result.userMessage || 'Telefone confirmado com sucesso.');
    await refreshUser?.();
    await load();
  });


  const identity = data?.identity;
  const complete = Boolean(identity?.email.verified && identity?.phone.verified);

  const status = (verified?: boolean) => verified
    ? <span className="identity-status is-ok"><CheckCircle2 /> CONFIRMADO</span>
    : <span className="identity-status"><RefreshCw /> PENDENTE</span>;

  return createPortal(<main className="identity-screen"><div className="identity-page">
    <header className="identity-header"><button onClick={() => navigate('/profile/wallet')} aria-label="Voltar"><ArrowLeft /></button><div><InvictusLogo size={40}/><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div><span /></header>
    <section className="identity-title"><small>SEGURANÇA DA CONTA</small><h1>IDENTIDADE <span>VERIFICADA</span></h1><p>Para liberar saques, confirme seu e-mail e seu telefone.</p></section>

    {error ? <div className="identity-alert is-error">{error}</div> : null}
    {notice ? <div className="identity-alert is-success">{notice}</div> : null}
    {loading && !data ? <div className="identity-loading"><Loader2 className="is-spinning"/> CONSULTANDO CONTA</div> : <>
      <section className={complete ? 'identity-complete is-ok' : 'identity-complete'}><ShieldCheck/><div><b>{complete ? 'CONTA VERIFICADA' : 'VERIFICAÇÃO PENDENTE'}</b><p>{complete ? 'E-mail e telefone estão confirmados.' : 'Conclua e-mail e telefone para liberar o saque.'}</p></div></section>

      <section className="identity-card"><header><MailCheck/><div><small>E-MAIL</small><h2>{identity?.email.value || auth.currentUser?.email || 'E-mail da conta'}</h2></div>{status(identity?.email.verified)}</header>{!identity?.email.verified ? <div className="identity-actions"><button disabled={Boolean(busy)} onClick={() => void resendEmail()}>{busy === 'email' ? <Loader2 className="is-spinning"/> : <MessageSquareText/>} ENVIAR E-MAIL INVICTUS</button><button className="is-secondary" disabled={Boolean(busy)} onClick={() => void syncEmail()}>JÁ CONFIRMEI</button></div> : <p>Endereço confirmado.</p>}</section>

      <section className="identity-card"><header><Smartphone/><div><small>TELEFONE</small><h2>{identity?.phone.value || 'Confirme seu celular'}</h2></div>{status(identity?.phone.verified)}</header>{!identity?.phone.verified ? <div className="identity-form"><label>CELULAR COM DDD<input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" placeholder="(51) 99999-9999" /></label>{phoneStep === 'code' ? <label>CÓDIGO RECEBIDO<input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" /></label> : null}<div className="identity-actions">{phoneStep === 'code' ? <><button disabled={Boolean(busy) || code.length < 4} onClick={() => void confirmPhone()}>{busy === 'phone-confirm' ? <Loader2 className="is-spinning"/> : <UserCheck/>} CONFIRMAR CÓDIGO</button><button className="is-secondary" disabled={Boolean(busy)} onClick={() => void startPhone()}>REENVIAR CÓDIGO</button></> : <button id="identity-send-phone-button" disabled={Boolean(busy) || phone.replace(/\D/g, '').length < 10} onClick={() => void startPhone()}>{busy === 'phone-start' ? <Loader2 className="is-spinning"/> : <MessageSquareText/>} CONFIRMAR TELEFONE</button>}</div></div> : <p>Número confirmado.</p>}</section>


      <div id="invictus-phone-recaptcha" aria-hidden="true" />
    </>}
  </div></main>, document.body);
}
