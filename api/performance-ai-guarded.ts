import type { VercelRequest, VercelResponse } from '@vercel/node';
import performanceAiHandler from './_handlers/performance-ai.js';
import { cors, verifyAuth } from './_lib/common.js';
import { getAiApiKey } from './_lib/ai-config.js';

const MEMORY_ACTIONS = new Set(['get-memories', 'add-memory', 'delete-memory']);

function sanitizeClientProfile(req: VercelRequest) {
  if (req.method !== 'POST' || !req.body || typeof req.body !== 'object') return;
  const profile = req.body.userProfile;
  if (!profile || typeof profile !== 'object') {
    if ('userProfile' in req.body) {
      const { userProfile: _ignored, ...rest } = req.body;
      req.body = rest;
    }
    return;
  }

  // O handler canônico reconstrói biometria, objetivo, scores, macros e
  // personalidade a partir do Firestore. Do cliente só preservamos os campos
  // de identidade usados para detectar tentativa de trocar o atleta.
  const safeIdentity: Record<string, string> = {};
  if (typeof profile.uid === 'string') safeIdentity.uid = profile.uid.slice(0, 160);
  if (typeof profile.id === 'string') safeIdentity.id = profile.id.slice(0, 160);
  req.body = { ...req.body, userProfile: safeIdentity };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (cors(req, res)) return;
  sanitizeClientProfile(req);

  const payload = req.method === 'GET' ? req.query : req.body || {};
  const action = typeof payload.action === 'string' ? payload.action : '';

  // Memória explícita não depende do provider generativo. Para chat/relatório,
  // se a chave estiver ausente paramos ANTES do handler consumir quota. Só
  // fazemos uma verificação auth extra neste cenário excepcional para manter
  // a semântica 401 de tokens inválidos e não revelar configuração a anônimos.
  if (!MEMORY_ACTIONS.has(action) && !getAiApiKey()) {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
    return res.status(503).json({
      error: 'A Invictus IA está sem uma chave da Gemini API configurada no servidor.',
      code: 'AI_NOT_CONFIGURED',
      isBillingError: false,
    });
  }

  return performanceAiHandler(req, res);
}
