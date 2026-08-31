import React from 'react';
import { ArrowLeft, ArrowRight, Calendar, Check, Dumbbell, Fingerprint, Lock, Mail, Phone, Share2, ShieldCheck, Sparkles, User } from 'lucide-react';
import { InvictusLogo } from './InvictusLogo';
import './AuthExperience.css';

export type RegistrationField = 'fullName' | 'cpf' | 'birthDate' | 'email' | 'password' | 'whatsapp' | 'referralCode';

type Props = {
  registering: boolean;
  forgotPassword: boolean;
  resetEmailSent: boolean;
  loading: boolean;
  socialLoading: boolean;
  error: string;
  step: number;
  fields: Record<RegistrationField, string>;
  termsAccepted: boolean;
  whatsappOptIn: boolean;
  preferredPlan: 'open' | 'performance';
  onField: (field: RegistrationField, value: string) => void;
  onLogin: (event: React.FormEvent) => void;
  onRegister: (event: React.FormEvent) => void;
  onForgot: (event: React.FormEvent) => void;
  onGoogle: () => void;
  onClearCache: () => void;
  onRegistering: (value: boolean) => void;
  onForgotPassword: (value: boolean) => void;
  onStep: (step: number) => void;
  onTerms: (value: boolean) => void;
  onWhatsappOptIn: (value: boolean) => void;
  onPlan: (value: 'open' | 'performance') => void;
};

const fieldMeta: Record<RegistrationField, { label: string; placeholder: string; type?: string; icon: React.ReactNode; maxLength?: number }> = {
  fullName: { label: 'Nome completo', placeholder: 'Como você quer ser chamado', icon: <User /> },
  cpf: { label: 'CPF', placeholder: '000.000.000-00', icon: <Fingerprint />, maxLength: 14 },
  birthDate: { label: 'Data de nascimento', placeholder: '', type: 'date', icon: <Calendar /> },
  email: { label: 'E-mail', placeholder: 'seu@email.com', type: 'email', icon: <Mail /> },
  password: { label: 'Senha', placeholder: 'Mínimo de 6 caracteres', type: 'password', icon: <Lock /> },
  whatsapp: { label: 'WhatsApp (opcional)', placeholder: '(00) 00000-0000', type: 'tel', icon: <Phone /> },
  referralCode: { label: 'Código de indicação (opcional)', placeholder: 'CÓDIGO-AMIGO', icon: <Share2 /> },
};

function Field({ name, value, onChange }: { name: RegistrationField; value: string; onChange: Props['onField'] }) {
  const meta = fieldMeta[name];
  return <label className="auth-field"><span>{meta.label}</span><div>{meta.icon}<input value={value} onChange={(event) => onChange(name, event.target.value)} type={meta.type || 'text'} placeholder={meta.placeholder} maxLength={meta.maxLength} autoComplete={name === 'password' ? 'new-password' : undefined} /></div></label>;
}

function Progress({ step }: { step: number }) {
  const labels = ['Conta', 'Identidade', 'Contato', 'Acesso'];
  return <div className="auth-progress" aria-label={`Etapa ${step} de 4`}>{labels.map((label, index) => <div key={label} className={index + 1 <= step ? 'is-active' : ''}><i>{index + 1 < step ? <Check /> : index + 1}</i><span>{label}</span></div>)}</div>;
}

export function AuthExperience(props: Props) {
  const { fields } = props;
  const stepValid = props.step === 1
    ? Boolean(fields.fullName.trim() && fields.email.trim() && fields.password.length >= 6)
    : props.step === 2
      ? Boolean(fields.cpf.replace(/\D/g, '').length === 11 && fields.birthDate)
      : props.step === 3
        ? true
        : props.termsAccepted;

  const advance = () => { if (stepValid) props.onStep(Math.min(4, props.step + 1)); };
  const back = () => props.step === 1 ? props.onRegistering(false) : props.onStep(props.step - 1);

  return <main className="auth-experience">
    <div className="auth-ambient" aria-hidden="true"><span /><span /><span /></div>
    <section className="auth-shell">
      <header className="auth-brand"><InvictusLogo size={76} showText /><p>PERFORMANCE QUE COMEÇA COM CONSISTÊNCIA</p></header>

      {!props.registering ? <div className="auth-card">
        {props.forgotPassword ? <form onSubmit={props.onForgot}>
          <button type="button" className="auth-back" onClick={() => props.onForgotPassword(false)}><ArrowLeft /> Voltar</button>
          <div className="auth-copy"><small>RECUPERAÇÃO SEGURA</small><h1>RECUPERAR ACESSO</h1><p>Enviaremos um link de redefinição para o seu e-mail.</p></div>
          <Field name="email" value={fields.email} onChange={props.onField} />
          {props.resetEmailSent && <div className="auth-success"><Check /> Link enviado. Verifique também a caixa de spam.</div>}
          {props.error && <div className="auth-error">{props.error}</div>}
          <button className="auth-primary" disabled={props.loading || !fields.email} type="submit">{props.loading ? 'ENVIANDO...' : <>ENVIAR LINK <ArrowRight /></>}</button>
        </form> : <form onSubmit={props.onLogin}>
          <div className="auth-copy"><small>BEM-VINDO DE VOLTA</small><h1>ENTRE NA ARENA</h1><p>Acesse seus treinos, desafios e evolução em um só lugar.</p></div>
          <Field name="email" value={fields.email} onChange={props.onField} />
          <Field name="password" value={fields.password} onChange={props.onField} />
          <button type="button" className="auth-forgot" onClick={() => props.onForgotPassword(true)}>Esqueci minha senha</button>
          {props.error && <div className="auth-error">{props.error}<button type="button" onClick={props.onClearCache}>Limpar dados locais</button></div>}
          <button className="auth-primary" disabled={props.loading || props.socialLoading} type="submit">{props.loading ? 'AUTENTICANDO...' : <>ENTRAR <ArrowRight /></>}</button>
          <div className="auth-divider"><span>OU</span></div>
          <button className="auth-google" disabled={props.loading || props.socialLoading} type="button" onClick={props.onGoogle}><b>G</b>{props.socialLoading ? 'CONECTANDO...' : 'CONTINUAR COM GOOGLE'}</button>
          <p className="auth-switch">Ainda não tem conta? <button type="button" onClick={() => props.onRegistering(true)}>Criar conta grátis</button></p>
        </form>}
      </div> : <div className="auth-card auth-registration">
        <button type="button" className="auth-back" onClick={back}><ArrowLeft /> {props.step === 1 ? 'Voltar ao login' : 'Etapa anterior'}</button>
        <div className="auth-copy"><small>CADASTRO INVICTUS</small><h1>{['SUA CONTA', 'SEUS DADOS', 'COMO FALAR COM VOCÊ', 'ESCOLHA SEU ACESSO'][props.step - 1]}</h1><p>{['Crie suas credenciais de acesso.', 'Dados usados para segurança e elegibilidade.', 'Essas informações são opcionais e podem ser alteradas.', 'Comece grátis ou conheça os recursos PRO.'][props.step - 1]}</p></div>
        <Progress step={props.step} />
        <form onSubmit={props.onRegister}>
          {props.step === 1 && <><Field name="fullName" value={fields.fullName} onChange={props.onField} /><Field name="email" value={fields.email} onChange={props.onField} /><Field name="password" value={fields.password} onChange={props.onField} /></>}
          {props.step === 2 && <><Field name="cpf" value={fields.cpf} onChange={props.onField} /><Field name="birthDate" value={fields.birthDate} onChange={props.onField} /><div className="auth-trust"><ShieldCheck /><span><b>Seus dados são protegidos</b><small>O CPF evita contas duplicadas e será necessário apenas em operações que exigem identificação.</small></span></div></>}
          {props.step === 3 && <><Field name="whatsapp" value={fields.whatsapp} onChange={props.onField} /><Field name="referralCode" value={fields.referralCode} onChange={props.onField} /><label className="auth-check"><input type="checkbox" checked={props.whatsappOptIn} onChange={(event) => props.onWhatsappOptIn(event.target.checked)} /><i><Check /></i><span><b>Lembretes pelo WhatsApp</b><small>Opcional. Você pode desativar quando quiser.</small></span></label></>}
          {props.step === 4 && <><div className="auth-plans"><button type="button" className={props.preferredPlan === 'open' ? 'is-selected' : ''} onClick={() => props.onPlan('open')}><Dumbbell /><span><b>INVICTUS OPEN</b><small>Treinos, desafios e evolução essencial</small></span><em>GRÁTIS</em></button><button type="button" className={props.preferredPlan === 'performance' ? 'is-selected' : ''} onClick={() => props.onPlan('performance')}><Sparkles /><span><b>PERFORMANCE PRO</b><small>Recursos avançados e inteligência personalizada</small></span><em>PRO</em></button></div><label className="auth-check"><input type="checkbox" checked={props.termsAccepted} onChange={(event) => props.onTerms(event.target.checked)} /><i><Check /></i><span><b>Termos e privacidade</b><small>Li e aceito os Termos de Uso e a Política de Privacidade. Permissões sensíveis serão solicitadas no momento do uso.</small></span></label></>}
          {props.error && <div className="auth-error">{props.error}</div>}
          {props.step < 4 ? <button className="auth-primary" type="button" disabled={!stepValid} onClick={advance}>CONTINUAR <ArrowRight /></button> : <button className="auth-primary" type="submit" disabled={!stepValid || props.loading}>{props.loading ? 'CRIANDO CONTA...' : <>CRIAR MINHA CONTA <ArrowRight /></>}</button>}
        </form>
      </div>}
      <footer><ShieldCheck /> Seus dados protegidos pela Invictus Performance</footer>
    </section>
  </main>;
}
