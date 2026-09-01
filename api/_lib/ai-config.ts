const read = (value: string | undefined) => value?.trim() || '';

export type AiFailureCode =
  | 'AI_NOT_CONFIGURED'
  | 'BILLING_REQUIRED'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_API_KEY'
  | 'PERMISSION_DENIED'
  | 'MODEL_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'UPSTREAM_ERROR';

export interface AiFailure {
  code: AiFailureCode;
  message: string;
  status: 429 | 502 | 503;
  isBillingError: boolean;
  retryable: boolean;
}

/**
 * Aceita os dois nomes usados pelos serviços Google. A chave continua
 * exclusivamente no servidor e nunca é enviada ao bundle do aplicativo.
 */
export function getAiApiKey(): string {
  return read(process.env.GEMINI_API_KEY) || read(process.env.GOOGLE_API_KEY);
}

const RETIRED_FOR_NEW_ACCOUNTS = new Set(['gemini-2.5-flash', 'models/gemini-2.5-flash']);

/**
 * Modelo estável por padrão. A migração explícita impede que uma variável
 * antiga na Vercel mantenha contas novas presas ao endpoint 2.5 desativado.
 */
export function getAiTextModel(): string {
  const configured = read(process.env.GEMINI_TEXT_MODEL);
  if (!configured || RETIRED_FOR_NEW_ACCOUNTS.has(configured)) return 'gemini-3.6-flash';
  return configured.replace(/^models\//, '');
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) || '';
  } catch {
    return String(error || '');
  }
}

/** Classifica falhas sem expor o JSON interno do provedor ao atleta. */
export function classifyAiError(error: unknown): AiFailure {
  const text = errorText(error);
  const normalized = text.toLowerCase();

  if (/ai_not_configured|gemini_api_key|google_api_key|chave.+(?:não|nao).+configurada/.test(normalized)) {
    return {
      code: 'AI_NOT_CONFIGURED',
      message: 'A Invictus IA está sem uma chave da Gemini API configurada no servidor.',
      status: 503,
      isBillingError: false,
      retryable: false
    };
  }
  if (/billing_required|billing account|enable billing|billing.+(?:required|disabled|pending|not active|not enabled|inactive|suspended)|faturamento.+(?:pendente|inativ|desativ|suspens)|payment required|credit balance|insufficient funds/.test(normalized)) {
    return {
      code: 'BILLING_REQUIRED',
      message: 'O faturamento do projeto Google ainda não está ativo ou está pendente. Ative ou conclua o faturamento associado à chave da Gemini API e tente novamente.',
      status: 503,
      isBillingError: true,
      retryable: false
    };
  }
  if (/quota|resource[_ -]?exhausted|rate.?limit|too many requests|\b429\b|exceeded.+(?:limit|quota)/.test(normalized)) {
    return {
      code: 'QUOTA_EXCEEDED',
      message: 'A Invictus IA atingiu o limite temporário de uso da Gemini API. Verifique as cotas do projeto ou tente novamente em alguns minutos.',
      status: 429,
      isBillingError: false,
      retryable: true
    };
  }
  if (/api.?key|invalid.+key|key.+invalid|keyinvalid|unauthenticated/.test(normalized)) {
    return {
      code: 'INVALID_API_KEY',
      message: 'A chave da Gemini API configurada no servidor é inválida ou não foi aceita.',
      status: 503,
      isBillingError: false,
      retryable: false
    };
  }
  if (/permission[_ -]?denied|request[_ -]?denied|forbidden|\b403\b/.test(normalized)) {
    return {
      code: 'PERMISSION_DENIED',
      message: 'O projeto não tem permissão para usar a Gemini API. Verifique a API Generative Language, o faturamento e as restrições da chave.',
      status: 503,
      isBillingError: false,
      retryable: false
    };
  }
  if (/model.+(?:not found|no longer available|unavailable|unsupported)|(?:not found|no longer available).+model|\bnot_found\b/.test(normalized)) {
    return {
      code: 'MODEL_UNAVAILABLE',
      message: 'A Invictus IA está sendo atualizada. Tente novamente em alguns instantes.',
      status: 503,
      isBillingError: false,
      retryable: true
    };
  }
  if (/fetch failed|network|econnreset|econnrefused|etimedout|timeout|socket|\b502\b|\b503\b/.test(normalized)) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Não foi possível alcançar o serviço da Gemini API agora. Tente novamente.',
      status: 503,
      isBillingError: false,
      retryable: true
    };
  }
  return {
    code: 'UPSTREAM_ERROR',
    message: 'Não foi possível gerar uma resposta da Invictus IA agora. Tente novamente.',
    status: 502,
    isBillingError: false,
    retryable: true
  };
}

/** Compatibilidade para os handlers que só precisam da mensagem amigável. */
export function friendlyAiError(error: unknown): string {
  return classifyAiError(error).message;
}
