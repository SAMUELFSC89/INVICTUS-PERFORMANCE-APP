const SERPRO_TOKEN_URL = 'https://gateway.apiserpro.serpro.gov.br/token';

export type IdentityProviderReadiness = {
  phone: true;
  cpf: boolean;
};

export type CpfVerificationResult = {
  matched: boolean;
  regular: boolean;
  status: string;
  provider: 'serpro_receita_federal';
};

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Serviço de verificação indisponível: ${name} não configurado.`);
  return value;
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/**
 * Telefone é verificado pelo Firebase Authentication no cliente e sincronizado
 * no backend a partir do UserRecord do Firebase Admin. Portanto não existe
 * segredo/provedor SMS adicional no servidor. O único provider externo que
 * ainda precisa de credenciais próprias é a Consulta CPF do Serpro.
 */
export function getIdentityProviderReadiness(): IdentityProviderReadiness {
  return {
    phone: true,
    cpf: Boolean(
      process.env.SERPRO_CPF_CONSUMER_KEY
      && process.env.SERPRO_CPF_CONSUMER_SECRET
      && process.env.SERPRO_CPF_QUERY_URL_TEMPLATE
    ),
  };
}

export function normalizeBrazilianPhone(input: unknown): string {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  throw new Error('Informe um telefone brasileiro válido com DDD.');
}

export function maskPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 6) return '••••';
  const ddd = digits.slice(-11, -9);
  const end = digits.slice(-4);
  return `(${ddd}) •••••-${end}`;
}

function formatBirthDateForSerpro(value: unknown): string {
  const raw = String(value || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return `${iso[3]}${iso[2]}${iso[1]}`;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 8) return digits;
  throw new Error('Data de nascimento inválida para confirmar o CPF.');
}

function normalizeCpf(value: unknown): string {
  const cpf = String(value || '').replace(/\D/g, '');
  if (cpf.length !== 11) throw new Error('CPF inválido.');
  return cpf;
}

function cpfChecksumValid(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(cpf[i]) * (length + 1 - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

async function getSerproToken(): Promise<string> {
  const key = requiredEnv('SERPRO_CPF_CONSUMER_KEY');
  const secret = requiredEnv('SERPRO_CPF_CONSUMER_SECRET');
  const response = await fetch(String(process.env.SERPRO_CPF_TOKEN_URL || SERPRO_TOKEN_URL), {
    method: 'POST',
    headers: {
      Authorization: basicAuth(key, secret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  const payload: any = await response.json().catch(() => ({}));
  const token = String(payload?.access_token || '');
  if (!response.ok || !token) {
    console.error(`[IdentityVerification] SERPRO token failed (${response.status}).`);
    throw new Error('A confirmação oficial do CPF está temporariamente indisponível.');
  }
  return token;
}

function buildSerproCpfUrl(cpf: string, birthDate: string): string {
  const template = requiredEnv('SERPRO_CPF_QUERY_URL_TEMPLATE');
  if (!template.includes('{cpf}') || !template.includes('{birthDate}')) {
    throw new Error('SERPRO_CPF_QUERY_URL_TEMPLATE deve conter {cpf} e {birthDate}.');
  }
  return template
    .replace('{cpf}', encodeURIComponent(cpf))
    .replace('{birthDate}', encodeURIComponent(birthDate));
}

function readCpfFromResponse(payload: any): string {
  return String(payload?.ni || payload?.cpf || payload?.numeroCpf || '').replace(/\D/g, '');
}

function readCpfStatus(payload: any): string {
  const raw = payload?.situacao?.descricao ?? payload?.situacaoCadastral ?? payload?.situacao ?? payload?.status ?? '';
  return String(raw || '').trim().toUpperCase();
}

export async function verifyCpfWithReceita(cpfInput: unknown, birthDateInput: unknown): Promise<CpfVerificationResult> {
  const cpf = normalizeCpf(cpfInput);
  if (!cpfChecksumValid(cpf)) throw new Error('CPF inválido. Confira o número informado.');
  const birthDate = formatBirthDateForSerpro(birthDateInput);
  const token = await getSerproToken();
  const url = buildSerproCpfUrl(cpf, birthDate);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const payload: any = await response.json().catch(() => ({}));

  if (response.status === 404) {
    return { matched: false, regular: false, status: 'NÃO CONFERE', provider: 'serpro_receita_federal' };
  }
  if (response.status !== 200 && response.status !== 206) {
    console.warn(`[IdentityVerification] SERPRO CPF query failed (${response.status}).`);
    if (response.status === 400) throw new Error('CPF ou data de nascimento inválidos para a Receita Federal.');
    if (response.status === 401 || response.status === 403) throw new Error('A integração oficial de CPF precisa ser reautorizada.');
    throw new Error('Não foi possível consultar a Receita Federal agora. Tente novamente mais tarde.');
  }

  const responseCpf = readCpfFromResponse(payload);
  const matched = responseCpf === cpf;
  const status = readCpfStatus(payload) || 'CONSULTADO';
  const regular = matched && (status === 'REGULAR' || status === '0');
  return { matched, regular, status, provider: 'serpro_receita_federal' };
}
