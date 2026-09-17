import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authMiddleware } from './_middleware/auth.js';
import { corsMiddleware } from './_middleware/cors.js';
import { db } from './_lib/common.js';
import { hasActiveAdminAuthority } from './_lib/admin-authority.js';
import { getAsaasBaseUrl } from './_lib/asaas-client.js';
import { logEvent } from './_lib/observability.js';

const TARGET_URL = 'https://sem-desculpa.vercel.app/api/championships/webhook-asaas';
const TARGET_PATH = '/api/championships/webhook-asaas';
const CONFIRMATION = 'FIX_ASAAS_SANDBOX_WEBHOOK_REDIRECT_308';

function safeWebhookSummary(webhook: any) {
  return {
    id: String(webhook?.id || ''),
    name: String(webhook?.name || ''),
    url: String(webhook?.url || ''),
    enabled: webhook?.enabled === true,
    interrupted: webhook?.interrupted === true,
    sendType: webhook?.sendType || null,
    events: Array.isArray(webhook?.events) ? webhook.events : [],
  };
}

async function callAsaas(path: string, init: RequestInit = {}) {
  const apiKey = String(process.env.ASAAS_API_KEY || '').trim();
  if (!apiKey) throw new Error('ASAAS_API_KEY não configurada.');

  const response = await fetch(`${getAsaasBaseUrl().replace(/\/$/, '')}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(20_000),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'InvictusPerformance/1.0 (Node.js)',
      access_token: apiKey,
      ...(init.headers || {}),
    },
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.errors?.[0]?.description || data?.message || `Asaas HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export default async function handler(
  req: VercelRequest & { userId?: string; userEmail?: string },
  res: VercelResponse,
) {
  if (corsMiddleware(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!(await authMiddleware(req, res))) return;

  const userSnap = await db.collection('users').doc(req.userId!).get();
  if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data())) {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }

  if (String(req.body?.confirmation || '') !== CONFIRMATION) {
    return res.status(400).json({ error: 'Confirmação administrativa inválida.' });
  }

  let base: URL;
  try {
    base = new URL(getAsaasBaseUrl());
  } catch {
    return res.status(500).json({ error: 'ASAAS_API_BASE_URL inválida.' });
  }

  if (base.hostname !== 'api-sandbox.asaas.com') {
    return res.status(409).json({
      error: 'Esta ferramenta temporária só pode alterar o Asaas Sandbox.',
      environmentHost: base.hostname,
    });
  }

  try {
    const listed = await callAsaas('/webhooks?offset=0&limit=100', { method: 'GET' });
    const webhooks = Array.isArray(listed) ? listed : Array.isArray(listed?.data) ? listed.data : [];

    const candidates = webhooks.filter((webhook: any) => {
      try {
        const url = new URL(String(webhook?.url || ''));
        return url.pathname === TARGET_PATH;
      } catch {
        return false;
      }
    });

    if (candidates.length === 0) {
      return res.status(404).json({
        error: 'Nenhum webhook do campeonato foi localizado no Asaas Sandbox.',
        targetUrl: TARGET_URL,
        webhooks: webhooks.map(safeWebhookSummary),
      });
    }

    const repaired = [];
    for (const webhook of candidates) {
      const id = String(webhook?.id || '').trim();
      if (!id) continue;
      const before = safeWebhookSummary(webhook);
      const updated = await callAsaas(`/webhooks/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          url: TARGET_URL,
          enabled: true,
          interrupted: false,
        }),
      });
      repaired.push({ before, after: safeWebhookSummary(updated) });
    }

    await logEvent({
      severity: 'HIGH_RISK',
      category: 'system_logs',
      message: 'Webhook Sandbox do Asaas apontado para domínio Vercel direto após falhas HTTP 308.',
      userId: req.userId!,
      route: '/api/admin-fix-asaas-webhook-sandbox',
      details: {
        targetUrl: TARGET_URL,
        webhookIds: repaired.map((item) => item.after.id),
        previousUrls: repaired.map((item) => item.before.url),
      },
    });

    return res.status(200).json({
      success: true,
      targetUrl: TARGET_URL,
      repairedCount: repaired.length,
      repaired,
    });
  } catch (error: any) {
    console.error('[Asaas webhook sandbox repair] falha:', error);
    return res.status(502).json({ error: error?.message || 'Falha ao corrigir o webhook no Asaas Sandbox.' });
  }
}
