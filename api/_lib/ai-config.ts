const read = (value: string | undefined) => value?.trim() || '';

/**
 * Aceita os dois nomes usados pelos serviços Google. A chave continua
 * exclusivamente no servidor e nunca é enviada ao bundle do aplicativo.
 */
export function getAiApiKey(): string {
  return read(process.env.GEMINI_API_KEY) || read(process.env.GOOGLE_API_KEY);
}

/** Modelo estável por padrão; pode ser trocado no ambiente sem novo deploy. */
export function getAiTextModel(): string {
  return read(process.env.GEMINI_TEXT_MODEL) || 'gemini-2.5-flash';
}
