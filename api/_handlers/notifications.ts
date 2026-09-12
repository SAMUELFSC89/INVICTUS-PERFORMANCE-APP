import { createHash } from 'node:crypto';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { notificationService } from '../_services/notification-service.js';

/**
 * POST /api/notifications
 * Unified endpoint for signed-in notification operations.
 *
 * - Default body creates a notification for the authenticated user only.
 * - action=claim-device-token makes a physical push token single-owner. This
 *   prevents one device token from remaining attached to account A after the
 *   same device changes to account B.
 * - action=remove-device-token removes ownership only when the authenticated
 *   account currently owns that token.
 */

const ALLOWED_TYPES = ['ranking', 'payment', 'system', 'achievement', 'social'];
const MAX_TEXT_LEN = 300;

function pushTokenMeta(body: any): { token: string; platform: 'ios' | 'android'; tokenField: 'apnsTokens' | 'fcmTokens'; registryId: string } | null {
  const token = String(body?.token || '').trim();
  const platform: 'ios' | 'android' = body?.platform === 'ios' ? 'ios' : 'android';
  const validToken = platform === 'ios'
    ? /^[A-Fa-f0-9]{64,256}$/.test(token)
    : /^[A-Za-z0-9:._-]{20,4096}$/.test(token);
  if (!validToken) return null;
  return {
    token,
    platform,
    tokenField: platform === 'ios' ? 'apnsTokens' : 'fcmTokens',
    registryId: createHash('sha256').update(`${platform}:${token}`).digest('hex'),
  };
}

async function claimDeviceToken(authUid: string, body: any) {
  const meta = pushTokenMeta(body);
  if (!meta) throw Object.assign(new Error('Token de dispositivo inválido.'), { statusCode: 400 });

  // Procura vínculos legados criados antes do índice de proprietário único.
  // O resultado nunca é devolvido ao cliente; serve apenas para limpar o mesmo
  // token de contas anteriores durante a primeira reivindicação segura.
  const legacyOwners = await db.collection('users')
    .where(meta.tokenField, 'array-contains', meta.token)
    .limit(20)
    .get();

  const registryRef = db.collection('push_device_tokens').doc(meta.registryId);
  const now = new Date().toISOString();

  await db.runTransaction(async (transaction: any) => {
    const registrySnap = await transaction.get(registryRef);
    const indexedOwner = registrySnap.exists ? String(registrySnap.data()?.ownerUid || '') : '';
    const ownerIds = new Set<string>([authUid]);
    legacyOwners.docs.forEach((item: any) => ownerIds.add(item.id));
    if (indexedOwner) ownerIds.add(indexedOwner);

    // Todas as leituras acontecem antes de qualquer escrita para manter a
    // transação válida no Firestore e serializável pelo documento-registro.
    const profiles = new Map<string, any>();
    for (const uid of ownerIds) {
      profiles.set(uid, await transaction.get(db.collection('users').doc(uid)));
    }

    const currentProfile = profiles.get(authUid);
    if (!currentProfile?.exists) throw new Error('Perfil do usuário não encontrado.');

    for (const [uid, snapshot] of profiles.entries()) {
      if (!snapshot.exists) continue;
      const currentTokens = Array.isArray(snapshot.data()?.[meta.tokenField])
        ? snapshot.data()[meta.tokenField].filter((value: unknown): value is string => typeof value === 'string')
        : [];
      const nextTokens = uid === authUid
        ? [...new Set([...currentTokens, meta.token])].slice(-10)
        : currentTokens.filter((value: string) => value !== meta.token);
      if (nextTokens.length !== currentTokens.length || nextTokens.some((value, index) => value !== currentTokens[index])) {
        transaction.update(snapshot.ref, {
          [meta.tokenField]: nextTokens,
          pushTokenUpdatedAt: now,
        });
      }
    }

    transaction.set(registryRef, {
      ownerUid: authUid,
      platform: meta.platform,
      updatedAt: now,
    }, { merge: true });
  });

  return { platform: meta.platform };
}

async function removeDeviceToken(authUid: string, body: any) {
  const meta = pushTokenMeta(body);
  if (!meta) throw Object.assign(new Error('Token de dispositivo inválido.'), { statusCode: 400 });
  const registryRef = db.collection('push_device_tokens').doc(meta.registryId);
  const profileRef = db.collection('users').doc(authUid);

  await db.runTransaction(async (transaction: any) => {
    const [registrySnap, profileSnap] = await Promise.all([
      transaction.get(registryRef),
      transaction.get(profileRef),
    ]);
    if (!profileSnap.exists) throw new Error('Perfil do usuário não encontrado.');

    const currentTokens = Array.isArray(profileSnap.data()?.[meta.tokenField])
      ? profileSnap.data()![meta.tokenField].filter((value: unknown): value is string => typeof value === 'string')
      : [];
    transaction.update(profileRef, {
      [meta.tokenField]: currentTokens.filter((value: string) => value !== meta.token),
      pushTokenUpdatedAt: new Date().toISOString(),
    });

    if (registrySnap.exists && registrySnap.data()?.ownerUid === authUid) {
      transaction.delete(registryRef);
    }
  });

  return { platform: meta.platform };
}

export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const body = req.body || {};
  const action = String(body.action || '').trim();

  try {
    if (action === 'claim-device-token') {
      const result = await claimDeviceToken(auth.uid, body);
      return res.status(200).json({ success: true, registered: true, ...result });
    }
    if (action === 'remove-device-token') {
      const result = await removeDeviceToken(auth.uid, body);
      return res.status(200).json({ success: true, registered: false, ...result });
    }
  } catch (err: any) {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error(`[API /notifications] Erro ao atualizar token de dispositivo: ${err?.message || err}`);
    return res.status(status).json({ error: status < 500 ? err.message : 'Não foi possível atualizar este dispositivo.' });
  }

  const { recipientId, type, title, message, actionUrl } = body;

  if (!recipientId || typeof recipientId !== 'string') {
    return res.status(400).json({ error: 'recipientId é obrigatório.' });
  }
  if (recipientId !== auth.uid) {
    return res.status(403).json({ error: 'Não é permitido criar notificações para outro usuário.' });
  }
  if (!title || typeof title !== 'string' || title.length > MAX_TEXT_LEN) {
    return res.status(400).json({ error: 'title é obrigatório (máx 300 caracteres).' });
  }
  if (message && (typeof message !== 'string' || message.length > MAX_TEXT_LEN)) {
    return res.status(400).json({ error: 'message inválido (máx 300 caracteres).' });
  }
  const safeType = ALLOWED_TYPES.includes(type) ? type : 'system';

  try {
    await notificationService.notify({
      userId: recipientId,
      title,
      message,
      type: safeType,
      actionUrl: typeof actionUrl === 'string' ? actionUrl : undefined,
    });
    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error(`[API /notifications] Erro ao criar notificação: ${err.message}`);
    return res.status(500).json({ error: 'Erro ao criar notificação.' });
  }
}
