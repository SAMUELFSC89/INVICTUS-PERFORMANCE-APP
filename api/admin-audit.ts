import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from './_lib/common.js';
import { hasActiveAdminAuthority } from './_lib/admin-authority.js';
import {
  getActivityAudit,
  getAuditEngineCatalog,
  listSecurityReports,
  reconcileUserIgaAsAdmin,
} from './_lib/admin-audit-service.js';

async function requireAdmin(req: VercelRequest, res: VercelResponse) {
  const auth = await verifyAuth(req);
  if (!auth) {
    res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
    return null;
  }
  const snapshot = await db.collection('users').doc(auth.uid).get();
  if (!snapshot.exists || !hasActiveAdminAuthority(snapshot.data())) {
    res.status(403).json({ success: false, error: 'Acesso administrativo obrigatório.' });
    return null;
  }
  return auth;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const action = String(req.query.action || req.body?.action || 'engine-catalog');
  try {
    if (req.method === 'GET' && action === 'engine-catalog') {
      return res.status(200).json({ success: true, ...getAuditEngineCatalog() });
    }
    if (req.method === 'GET' && action === 'security-reports') {
      const result = await listSecurityReports(req.query.limit, String(req.query.decision || ''));
      return res.status(200).json({ success: true, ...result });
    }
    if (req.method === 'GET' && action === 'activity') {
      const audit = await getActivityAudit(String(req.query.activityId || ''));
      return res.status(200).json({ success: true, audit });
    }
    if (req.method === 'POST' && action === 'reconcile-iga') {
      const userId = String(req.body?.userId || '').trim();
      const reason = String(req.body?.reason || '').trim();
      const activityId = String(req.body?.activityId || '').trim();
      if (reason.length < 8) {
        return res.status(400).json({ success: false, error: 'Informe um motivo de auditoria com pelo menos 8 caracteres para reconciliar o IGA.' });
      }
      const result = await reconcileUserIgaAsAdmin(userId, auth.uid);
      await db.collection('admin_reviews').add({
        type: 'IGA_RECONCILIATION',
        status: 'completed',
        reviewerId: auth.uid,
        userId,
        activityId: activityId || null,
        reason,
        before: result.before,
        after: result.after,
        calculated: result.calculated,
        evidence: {
          source: 'canonical_iga_recalculation',
          activityId: activityId || null,
          endpoint: '/api/admin-audit?action=reconcile-iga',
        },
        createdAt: new Date().toISOString(),
      });
      return res.status(200).json({ ...result, reason });
    }
    return res.status(400).json({ success: false, error: 'Ação de auditoria não suportada.' });
  } catch (error: any) {
    console.error('[Admin audit]', error);
    const message = String(error?.message || 'Falha na auditoria administrativa.');
    const status = /não encontrado|inval/i.test(message) ? 404 : 500;
    return res.status(status).json({ success: false, error: message });
  }
}
