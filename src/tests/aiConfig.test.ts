import { friendlyAiError, getAiApiKey, getAiTextModel } from '../../api/_lib/ai-config';

describe('configuração central da Invictus IA', () => {
  const original = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GEMINI_TEXT_MODEL: process.env.GEMINI_TEXT_MODEL,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('aceita GOOGLE_API_KEY quando GEMINI_API_KEY não existe', () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = ' google-key ';
    expect(getAiApiKey()).toBe('google-key');
  });

  it('prioriza GEMINI_API_KEY quando as duas variáveis existem', () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GOOGLE_API_KEY = 'google-key';
    expect(getAiApiKey()).toBe('gemini-key');
  });

  it('usa o modelo estável padrão e permite configuração pelo ambiente', () => {
    delete process.env.GEMINI_TEXT_MODEL;
    expect(getAiTextModel()).toBe('gemini-3.6-flash');
    process.env.GEMINI_TEXT_MODEL = 'modelo-configurado';
    expect(getAiTextModel()).toBe('modelo-configurado');
  });

  it('migra configuração antiga 2.5 e normaliza o prefixo models', () => {
    process.env.GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
    expect(getAiTextModel()).toBe('gemini-3.6-flash');
    process.env.GEMINI_TEXT_MODEL = 'models/gemini-3.6-flash';
    expect(getAiTextModel()).toBe('gemini-3.6-flash');
  });

  it('não expõe o JSON interno do provedor ao atleta', () => {
    const message = friendlyAiError(new Error('{"error":{"code":404,"status":"NOT_FOUND","message":"model no longer available"}}'));
    expect(message).not.toContain('NOT_FOUND');
    expect(message).toContain('Invictus IA');
  });
});
