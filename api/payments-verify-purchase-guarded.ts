import type { VercelRequest, VercelResponse } from '@vercel/node';
import paymentsVerifyPurchaseHandler from './_handlers/payments-verify-purchase.js';
import { cors, verifyAuth } from './_lib/common.js';
import { consumeDistributedRateLimit } from './_lib/distributed-rate-limit.js';

const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function applyRetryAfter(res: VercelResponse, seconds: number) {
  res.setHeader('Retry-After', String(Math.max(1, Math.floor(seconds || 60))));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  // A identidade precisa ser verificada antes de virar chave de quota. Nunca
  // use Bearer bruto/uid enviado pelo cliente para formar o bucket.
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Sessão expirada ou inválida. Conecte-se novamente.' });

  // Limite diário primeiro: quando esgotado não consumimos o bucket de burst.
  const daily = await consumeDistributedRateLimit({
    scope: 'payments_verify_purchase_daily',
    subjectId: auth.uid,
    windowMs: ONE_DAY,
    maxRequests: 40,
  });
  if (!daily.allowed) {
    applyRetryAfter(res, daily.retryAfterSeconds);
    return res.status(daily.reason === 'store_unavailable' ? 503 : 429).json({
      error: daily.reason === 'store_unavailable'
        ? 'Não foi possível validar sua compra com segurança agora. Tente novamente em instantes.'
        : 'Muitas tentativas de confirmação de compra. Aguarde antes de tentar novamente.',
      code: daily.reason === 'store_unavailable' ? 'RATE_LIMIT_UNAVAILABLE' : 'PURCHASE_VERIFY_RATE_LIMITED',
    });
  }

  const burst = await consumeDistributedRateLimit({
    scope: 'payments_verify_purchase_burst',
    subjectId: auth.uid,
    windowMs: FIVE_MINUTES,
    maxRequests: 8,
  });
  if (!burst.allowed) {
    applyRetryAfter(res, burst.retryAfterSeconds);
    return res.status(burst.reason === 'store_unavailable' ? 503 : 429).json({
      error: burst.reason === 'store_unavailable'
        ? 'Não foi possível validar sua compra com segurança agora. Tente novamente em instantes.'
        : 'Muitas tentativas de confirmação de compra. Aguarde alguns minutos e tente novamente.',
      code: burst.reason === 'store_unavailable' ? 'RATE_LIMIT_UNAVAILABLE' : 'PURCHASE_VERIFY_RATE_LIMITED',
    });
  }

  // O handler canônico continua sendo a única implementação de provisionamento.
  // Ele revalida auth/lifecycle; a dupla checagem é deliberada neste endpoint
  // raro e financeiro para não abrir um caminho alternativo de autorização.
  return paymentsVerifyPurchaseHandler(req, res);
}
