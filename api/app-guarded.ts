import type { VercelRequest, VercelResponse } from '@vercel/node';
import appHandler from './app.js';
import performanceAiGuardedHandler from './performance-ai-guarded.js';
import { cors } from './_lib/common.js';

function requestAction(req: VercelRequest): string {
  const value = req.query?.action ?? req.body?.action;
  return typeof value === 'string' ? value.trim() : '';
}

function stravaAction(req: VercelRequest): string {
  const value = req.query?.stravaAction ?? req.body?.stravaAction;
  return typeof value === 'string' ? value.trim() : '';
}

function legacySensitiveActionDisabled(req: VercelRequest): { code: string; endpoint: string } | null {
  const action = requestAction(req);
  if (action === 'payments-verify-purchase') {
    return { code: 'LEGACY_PURCHASE_VERIFY_ALIAS_DISABLED', endpoint: '/api/payments/verify-purchase' };
  }
  if (action === 'validate-presence') {
    return { code: 'LEGACY_PRESENCE_ALIAS_DISABLED', endpoint: '/api/validate-presence' };
  }
  if (action === 'strava' && stravaAction(req) === 'webhook') {
    return { code: 'LEGACY_STRAVA_WEBHOOK_ALIAS_DISABLED', endpoint: '/api/strava/webhook' };
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = requestAction(req);

  // Compatibilidade segura: o alias antigo da IA continua funcionando, mas
  // passa exatamente pela mesma guarda do endpoint canônico.
  if (action === 'performance-ai') {
    return performanceAiGuardedHandler(req, res);
  }

  const disabled = legacySensitiveActionDisabled(req);
  if (disabled) {
    if (cors(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(410).json({
      error: 'Este alias legado foi desativado por segurança. Use o endpoint específico.',
      code: disabled.code,
      endpoint: disabled.endpoint,
    });
  }

  // Os demais aliases continuam usando o router legado enquanto são migrados.
  return appHandler(req, res);
}
