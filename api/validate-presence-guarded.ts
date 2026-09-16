import type { VercelRequest, VercelResponse } from '@vercel/node';
import validatePresenceHandler from './_handlers/validate-presence.js';
import { cors, verifyAuth } from './_lib/common.js';
import { getAiApiKey } from './_lib/ai-config.js';
import { consumeAiQuota } from './_lib/ai-quota.js';

const MAX_SELFIE_BASE64_CHARS = 8_000_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, userMessage: 'Método não permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({
      success: false,
      userMessage: 'Sessão expirada. Entre novamente para confirmar sua presença.',
    });
  }

  const presenceCheckId = typeof req.body?.presenceCheckId === 'string'
    ? req.body.presenceCheckId.trim()
    : '';
  const photoBase64 = typeof req.body?.photoBase64 === 'string'
    ? req.body.photoBase64.trim()
    : '';

  if (!presenceCheckId || !photoBase64) {
    return res.status(400).json({
      success: false,
      userMessage: 'ID de verificação e foto selfie são obrigatórios.',
    });
  }
  if (presenceCheckId.length > 160 || photoBase64.length > MAX_SELFIE_BASE64_CHARS) {
    return res.status(413).json({
      success: false,
      userMessage: 'A selfie enviada é inválida ou excede o limite permitido.',
    });
  }

  // Provider ausente não deve consumir quota nem claim financeiro.
  if (!getAiApiKey()) {
    return res.status(503).json({
      success: false,
      code: 'AI_NOT_CONFIGURED',
      userMessage: 'O serviço biométrico está temporariamente indisponível. Tente novamente.',
    });
  }

  const quota = await consumeAiQuota(auth.uid, 'presence_biometric');
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfterSeconds));
    const unavailable = quota.reason === 'quota_unavailable';
    return res.status(unavailable ? 503 : 429).json({
      success: false,
      code: unavailable ? 'AI_QUOTA_UNAVAILABLE' : 'AI_RATE_LIMITED',
      retryAfterSeconds: quota.retryAfterSeconds,
      userMessage: unavailable
        ? 'Não foi possível confirmar a disponibilidade da validação biométrica agora. Tente novamente em instantes.'
        : 'Muitas validações biométricas foram solicitadas. Aguarde antes de tentar novamente.',
    });
  }

  // O handler canônico continua responsável pelo claim atômico, referência,
  // decisão fail-closed e commit financeiro. Ele revalida auth/lifecycle.
  return validatePresenceHandler(req, res);
}
