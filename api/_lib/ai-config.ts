const read = (value: string | undefined) => value?.trim() || '';

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

/** Nunca devolve o JSON interno do provedor para a interface do atleta. */
export function friendlyAiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/model.+(?:not found|no longer available)|NOT_FOUND/i.test(message)) {
    return 'A Invictus IA está sendo atualizada. Tente gerar o plano novamente em alguns instantes.';
  }
  if (/quota|resource_exhausted|rate.?limit/i.test(message)) {
    return 'A Invictus IA atingiu o limite temporário de uso. Tente novamente em alguns minutos.';
  }
  if (/api.?key|permission_denied|unauthenticated/i.test(message)) {
    return 'A Invictus IA está temporariamente indisponível por configuração do serviço.';
  }
  return 'Não foi possível gerar o plano agora. Tente novamente.';
}
