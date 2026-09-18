import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from './_lib/common.js';
import { hasActiveAdminAuthority } from './_lib/admin-authority.js';
import {
  deleteChampionshipDraft,
  getChampionshipAdminState,
  publishChampionshipDraft,
  saveChampionshipDraft,
} from './_lib/admin-championship-service.js';

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
  const action = String(req.query.action || req.body?.action || 'state');

  try {
    if (req.method === 'GET' && action === 'state') {
      return res.status(200).json({ success: true, ...(await getChampionshipAdminState()) });
    }
    if (req.method === 'POST' && action === 'save-draft') {
      const draft = await saveChampionshipDraft(req.body?.draft || {}, auth.uid);
      return res.status(200).json({ success: true, draft });
    }
    if (req.method === 'POST' && action === 'delete-draft') {
      return res.status(200).json(await deleteChampionshipDraft(String(req.body?.championshipId || ''), auth.uid));
    }
    if (req.method === 'POST' && action === 'publish') {
      const championshipId = String(req.body?.championshipId || '').trim();
      if (!championshipId) return res.status(400).json({ success: false, error: 'championshipId é obrigatório.' });
      return res.status(200).json(await publishChampionshipDraft(championshipId, auth.uid));
    }
    return res.status(400).json({ success: false, error: 'Ação administrativa de campeonato não suportada.' });
  } catch (error: any) {
    console.error('[Admin championships]', error);
    const message = String(error?.message || 'Falha ao administrar campeonato.');
    const conflict = /edição anterior|concilia|conflito|imutável|FINALIZED|homologação/i.test(message);
    return res.status(conflict ? 409 : /inválid|precisa|deve|não pode|informe|publique|rascunho|obrigat/i.test(message) ? 400 : 500)
      .json({ success: false, error: message });
  }
}
