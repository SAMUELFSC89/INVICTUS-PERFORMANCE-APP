import { getAiApiKey, getAiTextModel } from '../../api/_lib/ai-config';

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
    expect(getAiTextModel()).toBe('gemini-2.5-flash');
    process.env.GEMINI_TEXT_MODEL = 'modelo-configurado';
    expect(getAiTextModel()).toBe('modelo-configurado');
  });
});
