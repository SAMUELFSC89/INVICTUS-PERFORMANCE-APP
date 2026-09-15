import { VercelRequest, VercelResponse } from '@vercel/node';
import { auth as firebaseAdminAuth, cors, db, verifyAuth } from '../_lib/common.js';
import { logEvent } from '../_lib/observability.js';
import { StravaApi } from '../_lib/strava-api.js';

const CONFIRMATION = 'EXCLUIR';
const RECENT_AUTH_MAX_AGE_SECONDS = 60 * 60;
const COMPLETION_WINDOW_DAYS = 30;

function bearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

export default async function accountDeletionHandler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const verified = await verifyAuth(req);
  if (!verified) return res.status(401).json({ error: 'Autenticação necessária.' });

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });

  let decoded: any;
  try {
    decoded = await firebaseAdminAuth().verifyIdToken(token, true);
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
  if (decoded.uid !== verified.uid) return res.status(401).json({ error: 'Sessão inconsistente.' });

  const authTime = Number(decoded.auth_time);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authTime) || nowSeconds - authTime > RECENT_AUTH_MAX_AGE_SECONDS) {
    return res.status(409).json({
      error: 'Por segurança, entre novamente na sua conta antes de solicitar a exclusão.',
      code: 'RECENT_LOGIN_REQUIRED',
    });
  }

  const confirmation = String(req.body?.confirmation || '').trim().toUpperCase();
  if (confirmation !== CONFIRMATION) {
    return res.status(400).json({ error: `Digite ${CONFIRMATION} para confirmar a solicitação.` });
  }

  const uid = verified.uid;
  const now = new Date();
  const requestedAt = now.toISOString();
  const completionDueAt = new Date(now.getTime() + COMPLETION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const userRef = db.collection('users').doc(uid);
  const requestRef = db.collection('account_deletion_requests').doc(uid);

  await db.runTransaction(async (transaction: any) => {
    const [userSnap, requestSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(requestRef),
    ]);
    if (!userSnap.exists) throw new Error('Perfil não encontrado.');

    const existingRequest = requestSnap.exists ? (requestSnap.data() || {}) : {};
    if (['requested', 'processing'].includes(String(existingRequest.status || ''))) return;

    transaction.set(requestRef, {
      uid,
      requestedAt,
      completionDueAt,
      status: 'requested',
      source: 'self_service',
      requestedBy: uid,
      emailAtRequest: verified.email || null,
      updatedAt: requestedAt,
    }, { merge: true });

    transaction.update(userRef, {
      role: 'user',
      isAdmin: false,
      isBlocked: true,
      status: 'blocked',
      accountStatus: 'deletion_requested',
      lifecycleStatus: 'deletion_requested',
      deletionStatus: 'requested',
      deletionRequestedAt: requestedAt,
      deletionRequestedBy: uid,
      fcmTokens: [],
      apnsTokens: [],
      notifications: false,
      pushTokenUpdatedAt: requestedAt,
      updatedAt: requestedAt,
    });
  });

  const cleanupWarnings: string[] = [];
  try {
    await new StravaApi(uid).deleteConnection();
  } catch (error: any) {
    cleanupWarnings.push('strava');
    console.warn(`[AccountDeletion] Falha ao desconectar Strava de ${uid}:`, error?.message || error);
  }

  try {
    await db.collection('wearable_configs').doc(uid).delete();
  } catch (error: any) {
    cleanupWarnings.push('wearable_config');
    console.warn(`[AccountDeletion] Falha ao limpar configuração wearable de ${uid}:`, error?.message || error);
  }

  let identityWarning = false;
  try {
    await firebaseAdminAuth().updateUser(uid, { disabled: true });
    await firebaseAdminAuth().revokeRefreshTokens(uid);
  } catch (error: any) {
    if (error?.code !== 'auth/user-not-found') {
      identityWarning = true;
      console.error(`[AccountDeletion] Lifecycle bloqueado, mas identidade ${uid} exige revisão:`, error);
    }
  }

  await logEvent({
    severity: 'HIGH_RISK',
    category: 'system_logs',
    message: 'Usuário solicitou exclusão da própria conta.',
    userId: uid,
    route: '/api/account-deletion',
    details: { requestedAt, completionDueAt, identityWarning, cleanupWarnings },
  }).catch((error) => console.warn('[AccountDeletion] Falha ao registrar auditoria:', error));

  return res.status(202).json({
    success: true,
    status: 'requested',
    requestedAt,
    completionDueAt,
    identityWarning,
    cleanupWarnings,
    message: 'Solicitação registrada. A conta foi bloqueada imediatamente e a exclusão dos dados elegíveis será processada em até 30 dias.',
    subscriptionNotice: 'Assinaturas da App Store ou Google Play são gerenciadas pela própria loja e podem continuar cobrando até serem canceladas nela.',
  });
}
