import { createHash } from 'node:crypto';
import { cors, db, verifyAuth } from '../_lib/common.js';

/**
 * POST /api/notifications
 * Authenticated client operations for the notification center.
 *
 * IMPORTANT: this endpoint does NOT create notification content from a client
 * token. Official ranking/payment/system/social alerts are emitted only by
 * trusted server workflows through NotificationService. The browser/mobile
 * client can only acknowledge existing notifications and manage its own push
 * device token.
 */

const MAX_NOTIFICATION_IDS = 50;

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

function notificationIds(body: any, action: string): string[] | null {
  const raw = action === 'mark-read' ? [body?.notificationId] : body?.notificationIds;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_NOTIFICATION_IDS) return null;
  const ids = raw
    .map((value: unknown) => typeof value === 'string' ? value.trim() : '')
    .filter((value: string) => value.length > 0 && value.length <= 160);
  if (ids.length !== raw.length) return null;
  return [...new Set(ids)];
}

async function markNotificationsRead(authUid: string, ids: string[]) {
  const profileRef = db.collection('users').doc(authUid);
  let changed = 0;
  await db.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(profileRef);
    if (!snapshot.exists) throw new Error('Perfil do usuário não encontrado.');
    const current = Array.isArray(snapshot.data()?.notifications) ? snapshot.data()!.notifications : [];
    const targetIds = new Set(ids);
    const next = current.map((item: any) => {
      if (!item || typeof item !== 'object' || !targetIds.has(String(item.id || '')) || item.read === true) return item;
      changed += 1;
      return { ...item, read: true };
    });
    if (changed > 0) transaction.update(profileRef, { notifications: next });
  });
  return { changed };
}

async function claimDeviceToken(authUid: string, body: any) {
  const meta = pushTokenMeta(body);
  if (!meta) throw Object.assign(new Error('Token de dispositivo inválido.'), { statusCode: 400 });

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
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const body = req.body || {};
  const action = String(body.action || '').trim();

  try {
    if (action === 'mark-read' || action === 'mark-all-read') {
      const ids = notificationIds(body, action);
      if (!ids) return res.status(400).json({ error: 'Notificação inválida.' });
      const result = await markNotificationsRead(auth.uid, ids);
      return res.status(200).json({ success: true, ...result });
    }
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
    console.error(`[API /notifications] Erro na ação ${action || 'desconhecida'}: ${err?.message || err}`);
    return res.status(status).json({ error: status < 500 ? err.message : 'Não foi possível atualizar as notificações agora.' });
  }

  // Conteúdo da central é oficial. Um token de usuário nunca pode inventar um
  // alerta de pagamento, ranking, sistema, conquista ou interação social.
  return res.status(403).json({ error: 'Notificações são geradas apenas por fluxos oficiais do servidor.' });
}
