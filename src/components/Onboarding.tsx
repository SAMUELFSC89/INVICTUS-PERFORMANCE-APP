import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  User, 
  Mail, 
  Lock, 
  Phone, 
  Calendar, 
  Fingerprint, 
  Check, 
  AlertCircle, 
  Loader2, 
  ShieldCheck,
  Eye,
  EyeOff
} from 'lucide-react';
import { UserProfile } from '../types';
import { userService } from '../services/userService';
import { auth, createUserWithEmailAndPassword } from '../firebase';
import { InvictusLogo } from './InvictusLogo';

interface OnboardingProps {
  user?: UserProfile | null;
  onComplete: () => void;
}

// Format CPF to 000.000.000-00
export function maskCPF(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

// Strict CPF validator with real verification digit calculation
export function validateCPF(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11) return false;

  // Reject CPF where all digits are identical (e.g. 00000000000, 11111111111, etc.)
  if (/^(\d)\1{10}$/.test(clean)) return false;

  // Calculate first verification digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean.charAt(i), 10) * (10 - i);
  }
  let remainder = 11 - (sum % 11);
  let digit1 = remainder >= 10 ? 0 : remainder;
  if (digit1 !== parseInt(clean.charAt(9), 10)) return false;

  // Calculate second verification digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean.charAt(i), 10) * (11 - i);
  }
  remainder = 11 - (sum % 11);
  let digit2 = remainder >= 10 ? 0 : remainder;
  if (digit2 !== parseInt(clean.charAt(10), 10)) return false;

  return true;
}

// Format Phone to (00) 00000-0000
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) {
    return digits.length > 0 ? `(${digits}` : '';
  }
  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

// Valid Brazilian DDDs (2 digits)
const VALID_DDDS = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99'
]);

export function validatePhone(phone: string): { valid: boolean; error?: string } {
  const digits = phone.replace(/\D/g, '');
  if (!digits) {
    return { valid: false, error: 'Celular/WhatsApp é obrigatório.' };
  }
  if (digits.length < 2) {
    return { valid: false, error: 'Informe o DDD obrigatório.' };
  }
  const ddd = digits.slice(0, 2);
  if (!VALID_DDDS.has(ddd)) {
    return { valid: false, error: 'DDD inválido. Informe um DDD válido.' };
  }
  if (digits.length < 11) {
    return { valid: false, error: 'Informe o número completo com 9 dígitos e DDD.' };
  }
  return { valid: true };
}

// Birth date validator: no future dates, minimum 16 years old
export function validateBirthDate(dateStr: string): { valid: boolean; age?: number; error?: string } {
  if (!dateStr) {
    return { valid: false, error: 'Data de nascimento é obrigatória.' };
  }
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    return { valid: false, error: 'Data de nascimento inválida.' };
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const birthDate = new Date(year, month, day);

  if (
    isNaN(birthDate.getTime()) || 
    birthDate.getFullYear() !== year || 
    birthDate.getMonth() !== month || 
    birthDate.getDate() !== day
  ) {
    return { valid: false, error: 'Data de nascimento inválida.' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (birthDate > today) {
    return { valid: false, error: 'A data de nascimento não pode estar no futuro.' };
  }

  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  if (age < 16) {
    return { valid: false, age, error: 'É necessário ter pelo menos 16 anos para se cadastrar.' };
  }
  if (age > 120) {
    return { valid: false, age, error: 'Data de nascimento inválida.' };
  }

  return { valid: true, age };
}

export function Onboarding({ user, onComplete }: OnboardingProps) {
  // Form fields state
  const [name, setName] = useState(user?.name || user?.displayName || '');
  const [email, setEmail] = useState(user?.email || auth.currentUser?.email || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [cpf, setCpf] = useState(user?.cpf ? maskCPF(user.cpf) : '');
  const [phone, setPhone] = useState(user?.phone || user?.phoneNumber ? maskPhone(user.phone || user.phoneNumber || '') : '');
  const [birthDate, setBirthDate] = useState(user?.birthDate || '');
  const [termsAccepted, setTermsAccepted] = useState(user?.termsAccepted ?? false);

  // Status & Validation error states
  const [loading, setLoading] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    cpf?: string;
    phone?: string;
    birthDate?: string;
    termsAccepted?: string;
  }>({});

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = maskCPF(e.target.value);
    setCpf(masked);
    if (errors.cpf) {
      setErrors(prev => ({ ...prev, cpf: undefined }));
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = maskPhone(e.target.value);
    setPhone(masked);
    if (errors.phone) {
      setErrors(prev => ({ ...prev, phone: undefined }));
    }
  };

  const handleBirthDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBirthDate(e.target.value);
    if (errors.birthDate) {
      setErrors(prev => ({ ...prev, birthDate: undefined }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: typeof errors = {};

    // 1. Nome
    if (!name.trim()) {
      newErrors.name = 'Nome completo é obrigatório.';
    } else if (name.trim().split(' ').length < 2) {
      newErrors.name = 'Por favor, informe seu nome e sobrenome.';
    }

    // 2. Email
    if (!email.trim()) {
      newErrors.email = 'E-mail é obrigatório.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = 'Informe um endereço de e-mail válido.';
    }

    // 3. Senha (se usuário não estiver autenticado ou desejar alterar)
    if (!auth.currentUser && !password) {
      newErrors.password = 'A senha é obrigatória.';
    } else if (password && password.length < 6) {
      newErrors.password = 'A senha deve conter no mínimo 6 caracteres.';
    }

    // 4. CPF: máscara e validação real com dígitos verificadores
    if (!cpf.trim()) {
      newErrors.cpf = 'CPF é obrigatório.';
    } else if (!validateCPF(cpf)) {
      newErrors.cpf = 'CPF inválido. Verifique os dígitos digitados.';
    }

    // 5. Celular / WhatsApp: máscara e DDD obrigatório
    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.valid) {
      newErrors.phone = phoneValidation.error;
    }

    // 6. Data de nascimento: sem datas futuras e idade mínima de 16 anos
    const birthValidation = validateBirthDate(birthDate);
    if (!birthValidation.valid) {
      newErrors.birthDate = birthValidation.error;
    }

    // 7. Termos de uso
    if (!termsAccepted) {
      newErrors.termsAccepted = 'Você deve aceitar os Termos de Uso e Regras do Desafio.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError('');

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const cleanCpf = cpf.replace(/\D/g, '');
      const cleanPhone = phone.replace(/\D/g, '');
      const birthValidation = validateBirthDate(birthDate);
      const calculatedAge = birthValidation.age || 0;

      if (!auth.currentUser && email && password) {
        // Criar usuário com email e senha no Firebase Auth
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }

      // Atualizar perfil do usuário com os dados obrigatórios
      await userService.updateProfile({
        name: name.trim(),
        displayName: name.trim(),
        email: email.trim(),
        cpf: cleanCpf,
        phone: cleanPhone,
        phoneNumber: cleanPhone,
        birthDate: birthDate,
        age: calculatedAge,
        termsAccepted: true,
        termsAcceptedAt: new Date().toISOString(),
        whatsappEnabled: true
      });

      onComplete();
    } catch (err: any) {
      console.error('Erro ao salvar cadastro:', err);
      const code = err?.code || '';
      const msg = err?.message || '';

      if (code === 'auth/email-already-in-use' || msg.includes('email-already-in-use')) {
        setErrors(prev => ({ ...prev, email: 'Este e-mail já está cadastrado em outra conta.' }));
      } else if (code === 'auth/weak-password' || msg.includes('weak-password')) {
        setErrors(prev => ({ ...prev, password: 'A senha escolhida é muito fraca.' }));
      } else if (code === 'auth/invalid-email' || msg.includes('invalid-email')) {
        setErrors(prev => ({ ...prev, email: 'O formato do e-mail é inválido.' }));
      } else {
        setGeneralError(msg || 'Erro ao processar cadastro. Por favor, tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Obter a data máxima para o seletor de nascimento (hoje)
  const todayISO = new Date().toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 z-[250] bg-background/95 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto font-sans">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg bg-surface border border-outline-variant/15 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 my-auto text-on-surface"
      >
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-1">
            <InvictusLogo size={36} className="w-9 h-9 text-primary" />
          </div>
          <h1 className="font-headline italic font-black text-2xl sm:text-3xl uppercase tracking-tight text-on-surface">
            Cadastro de Atleta
          </h1>
          <p className="text-xs text-on-surface-variant font-medium max-w-sm mx-auto">
            Preencha seus dados em etapa única para validar seu perfil oficial e desbloquear os treinos no Invictus.
          </p>
        </div>

        {/* General Error Banner */}
        {generalError && (
          <div className="bg-error/10 border border-error/20 rounded-2xl p-3.5 flex items-center gap-3 text-error text-xs font-semibold">
            <AlertCircle size={18} className="shrink-0" />
            <span>{generalError}</span>
          </div>
        )}

        {/* Single-Step Form (ETAPA ÚNICA) */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* 1. Nome Completo */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
              <User size={14} className="text-primary" />
              Nome Completo *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
              }}
              placeholder="Ex: Carlos Eduardo Silva"
              className={`w-full bg-surface-container-high border ${
                errors.name ? 'border-error focus:border-error' : 'border-outline-variant/30 focus:border-primary'
              } rounded-xl px-4 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none transition-all`}
            />
            {errors.name && (
              <p className="text-error text-xs font-medium pl-1 flex items-center gap-1">
                <AlertCircle size={12} className="inline" />
                {errors.name}
              </p>
            )}
          </div>

          {/* 2. E-mail e Senha */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* E-mail */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                <Mail size={14} className="text-primary" />
                E-mail *
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors(prev => ({ ...prev, email: undefined }));
                }}
                placeholder="atleta@invictus.com"
                className={`w-full bg-surface-container-high border ${
                  errors.email ? 'border-error focus:border-error' : 'border-outline-variant/30 focus:border-primary'
                } rounded-xl px-4 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none transition-all`}
              />
              {errors.email && (
                <p className="text-error text-xs font-medium pl-1 flex items-center gap-1">
                  <AlertCircle size={12} className="inline" />
                  {errors.email}
                </p>
              )}
            </div>

            {/* Senha */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                <Lock size={14} className="text-primary" />
                Senha {auth.currentUser ? '(Opcional)' : '*'}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password) setErrors(prev => ({ ...prev, password: undefined }));
                  }}
                  placeholder={auth.currentUser ? '•••••••• (manter atual)' : 'Mínimo 6 dígitos'}
                  className={`w-full bg-surface-container-high border ${
                    errors.password ? 'border-error focus:border-error' : 'border-outline-variant/30 focus:border-primary'
                  } rounded-xl pl-4 pr-10 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none transition-all`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60 hover:text-on-surface transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-error text-xs font-medium pl-1 flex items-center gap-1">
                  <AlertCircle size={12} className="inline" />
                  {errors.password}
                </p>
              )}
            </div>
          </div>

          {/* 3. CPF e Celular/WhatsApp */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* CPF */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                <Fingerprint size={14} className="text-primary" />
                CPF *
              </label>
              <input
                type="text"
                value={cpf}
                onChange={handleCpfChange}
                maxLength={14}
                placeholder="000.000.000-00"
                className={`w-full bg-surface-container-high border ${
                  errors.cpf ? 'border-error focus:border-error' : 'border-outline-variant/30 focus:border-primary'
                } rounded-xl px-4 py-3.5 text-sm font-mono text-on-surface placeholder:text-on-surface-variant/40 outline-none transition-all`}
              />
              {errors.cpf && (
                <p className="text-error text-xs font-medium pl-1 flex items-center gap-1">
                  <AlertCircle size={12} className="inline" />
                  {errors.cpf}
                </p>
              )}
            </div>

            {/* Celular / WhatsApp */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                <Phone size={14} className="text-primary" />
                Celular/WhatsApp *
              </label>
              <input
                type="tel"
                value={phone}
                onChange={handlePhoneChange}
                maxLength={15}
                placeholder="(11) 99999-9999"
                className={`w-full bg-surface-container-high border ${
                  errors.phone ? 'border-error focus:border-error' : 'border-outline-variant/30 focus:border-primary'
                } rounded-xl px-4 py-3.5 text-sm font-mono text-on-surface placeholder:text-on-surface-variant/40 outline-none transition-all`}
              />
              {errors.phone && (
                <p className="text-error text-xs font-medium pl-1 flex items-center gap-1">
                  <AlertCircle size={12} className="inline" />
                  {errors.phone}
                </p>
              )}
            </div>
          </div>

          {/* 4. Data de Nascimento */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
              <Calendar size={14} className="text-primary" />
              Data de Nascimento * (Mínimo 16 anos)
            </label>
            <input
              type="date"
              value={birthDate}
              max={todayISO}
              onChange={handleBirthDateChange}
              className={`w-full bg-surface-container-high border ${
                errors.birthDate ? 'border-error focus:border-error' : 'border-outline-variant/30 focus:border-primary'
              } rounded-xl px-4 py-3.5 text-sm text-on-surface outline-none transition-all`}
            />
            {errors.birthDate && (
              <p className="text-error text-xs font-medium pl-1 flex items-center gap-1">
                <AlertCircle size={12} className="inline" />
                {errors.birthDate}
              </p>
            )}
          </div>

          {/* 5. Aceite dos Termos de Uso */}
          <div className="space-y-1.5 pt-2">
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <div className="relative flex items-center justify-center mt-0.5">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => {
                    setTermsAccepted(e.target.checked);
                    if (errors.termsAccepted) setErrors(prev => ({ ...prev, termsAccepted: undefined }));
                  }}
                  className="sr-only"
                />
                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${
                  termsAccepted
                    ? 'bg-primary border-primary text-on-primary'
                    : errors.termsAccepted 
                      ? 'border-error bg-surface-container-high' 
                      : 'border-outline-variant/50 bg-surface-container-high group-hover:border-primary'
                }`}>
                  {termsAccepted && <Check size={14} strokeWidth={3} />}
                </div>
              </div>
              <span className="text-xs text-on-surface-variant leading-relaxed">
                Li e concordo com os <span className="text-primary font-bold underline">Termos de Uso</span>, Regras Antifraude e Política de Privacidade do Invictus.
              </span>
            </label>
            {errors.termsAccepted && (
              <p className="text-error text-xs font-medium pl-8 flex items-center gap-1">
                <AlertCircle size={12} className="inline" />
                {errors.termsAccepted}
              </p>
            )}
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-primary hover:bg-primary/90 text-on-primary rounded-2xl font-headline italic font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-98 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  <span>Salvando Cadastro...</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={20} />
                  <span>Concluir Cadastro</span>
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
