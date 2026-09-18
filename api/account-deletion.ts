import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from './_lib/common.js';

const REQUEST_COLLECTION = 'account_deletion_requests';
const REQUEST_VERSION = 1;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const identity = await verifyAuth(req);
  if (!identity) return res.status(401).json({ error: 'Autenticação necessária.' });

  const userRef = db.collection('users').doc(identity.uid);
  const requestRef = db.collection(REQUEST_COLLECTION).doc(identity.uid);

  if (req.method === 'GET') {
    const snapshot = await requestRef.get();
    const data = snapshot.exists ? snapshot.data() || {} : {};
    return res.status(200).json({
      requested: snapshot.exists && !['cancelled', 'completed'].includes(String(data.status || '').toLowerCase()),
      status: snapshot.exists ? String(data.status || 'requested') : 'none',
      requestedAt: data.requestedAt || null,
      completedAt: data.completedAt || null,
    });
  }

  const now = new Date().toISOString();
  const result = await db.runTransaction(async (transaction: any) => {
    const [userSnap, requestSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(requestRef),
    ]);

    if (!userSnap.exists) throw new Error('ACCOUNT_NOT_FOUND');
    const user = userSnap.data() || {};
    const current = requestSnap.exists ? requestSnap.data() || {} : {};
    const currentStatus = String(current.status || '').toLowerCase();

    if (requestSnap.exists && !['cancelled', 'completed'].includes(currentStatus)) {
      return { alreadyRequested: true, requestedAt: current.requestedAt || now };
    }

    transaction.set(requestRef, {
      uid: identity.uid,
      accountEmail: String(identity.email || user.email || '').toLowerCase(),
      status: 'requested',
      source: 'in_app',
      version: REQUEST_VERSION,
      requestedAt: now,
      updatedAt: now,
    }, { merge: true });

    transaction.set(userRef, {
      deletionStatus: 'requested',
      deletionRequestedAt: now,
      updatedAt: now,
    }, { merge: true });

    return { alreadyRequested: false, requestedAt: now };
  }).catch((error: any) => {
    if (error?.message === 'ACCOUNT_NOT_FOUND') return null;
    throw error;
  });

  if (!result) return res.status(404).json({ error: 'Conta não encontrada.' });

  return res.status(result.alreadyRequested ? 200 : 202).json({
    success: true,
    alreadyRequested: result.alreadyRequested,
    requestedAt: result.requestedAt,
    status: 'requested',
    message: result.alreadyRequested
      ? 'Sua solicitação de exclusão já está registrada.'
      : 'Solicitação de exclusão registrada. A conta e os dados associados serão processados conforme a política de retenção e as obrigações legais aplicáveis.',
    subscriptionNotice: 'Excluir a conta Invictus não cancela automaticamente uma assinatura feita pela App Store ou Google Play. Cancele a renovação na própria loja, se houver assinatura ativa.',
  });
}
