import { createSign } from 'node:crypto';
import * as http2 from 'node:http2';
import { db, app, FieldValue } from '../_lib/common.js';
import { getMessaging } from 'firebase-admin/messaging';

/**
 * Ponto único para notificações in-app e push.
 *
 * Android usa tokens FCM. No iOS o plugin Capacitor retorna um token APNs,
 * que não pode ser enviado ao Firebase Admin Messaging; por isso os tokens
 * APNs ficam em um campo separado e são entregues diretamente pela API APNs.
 */
export type NotificationType = 'ranking' | 'payment' | 'system' | 'achievement' | 'social';

export interface NotificationPayload {
  userId: string;
  title: string;
  message?: string;
  body?: string;
  type?: NotificationType | string;
  actionUrl?: string;
  data?: Record<string, string | number | boolean>;
}

type ApnsConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  endpoint: string;
};

type ApnsResult = {
  token: string;
  status: number;
  reason: string;
};

const MAX_STORED_NOTIFICATIONS = 50;
const MAX_PUSH_TOKENS = 10;
const MAX_PUSH_DATA_ENTRIES = 10;
let cachedApnsJwt: { value: string; expiresAt: number } | null = null;

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sanitizePushData(data?: NotificationPayload['data']): Record<string, string> {
  if (!data || typeof data !== 'object') return {};

  return Object.entries(data)
    .filter(([key, value]) => (
      /^[A-Za-z0-9_.-]{1,64}$/.test(key)
      && key !== 'aps'
      && key !== 'actionUrl'
      && value !== undefined
      && value !== null
    ))
    .slice(0, MAX_PUSH_DATA_ENTRIES)
    .reduce<Record<string, string>>((result, [key, value]) => {
      const serialized = String(value).slice(0, 256);
      if (serialized) result[key] = serialized;
      return result;
    }, {});
}

function getApnsConfig(): ApnsConfig | null {
  const teamId = text(process.env.APNS_TEAM_ID, 128);
  const keyId = text(process.env.APNS_KEY_ID, 128);
  const bundleId = text(process.env.APNS_BUNDLE_ID, 255);
  const rawPrivateKey = process.env.APNS_PRIVATE_KEY;
  const privateKey = rawPrivateKey ? rawPrivateKey.replace(/\\n/g, '\n').trim() : '';

  if (!teamId || !keyId || !bundleId || !privateKey) return null;
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    console.error('[NotificationService] APNS_PRIVATE_KEY não contém uma chave privada PEM válida.');
    return null;
  }

  return {
    teamId,
    keyId,
    privateKey,
    bundleId,
    endpoint: process.env.APNS_ENVIRONMENT === 'sandbox'
      ? 'https://api.sandbox.push.apple.com'
      : 'https://api.push.apple.com'
  };
}

function createApnsJwt(config: ApnsConfig): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedApnsJwt && cachedApnsJwt.expiresAt > now + 60) {
    return cachedApnsJwt.value;
  }

  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'ES256', kid: config.keyId })}.${encode({ iss: config.teamId, iat: now })}`;
  const signer = createSign('SHA256');
  signer.update(unsigned);
  signer.end();
  // APNs exige a assinatura ECDSA em formato IEEE P1363 (R || S), não DER.
  const signature = signer.sign({ key: config.privateKey, dsaEncoding: 'ieee-p1363' });
  const value = `${unsigned}.${signature.toString('base64url')}`;
  cachedApnsJwt = { value, expiresAt: now + (50 * 60) };
  return value;
}

function createApnsPayload(
  title: string,
  body: string,
  actionUrl?: string,
  data?: NotificationPayload['data']
): string | null {
  const customData = sanitizePushData(data);
  const payload: Record<string, unknown> = {
    aps: {
      alert: {
        title: text(title, 160),
        body: text(body, 2000)
      },
      sound: 'default'
    },
    ...customData
  };

  const safeActionUrl = text(actionUrl, 512);
  if (safeActionUrl) payload.actionUrl = safeActionUrl;

  let serialized = JSON.stringify(payload);
  // O limite APNs para alerta é 4 KB. Preservamos a entrega mesmo quando um
  // produtor interno envia uma mensagem extensa.
  if (Buffer.byteLength(serialized, 'utf8') > 4096) {
    (payload.aps as { alert: { title: string; body: string } }).alert.body = text(body, 512);
    serialized = JSON.stringify(payload);
  }
  return Buffer.byteLength(serialized, 'utf8') <= 4096 ? serialized : null;
}

function sendApnsRequest(
  session: http2.ClientHttp2Session,
  config: ApnsConfig,
  jwt: string,
  token: string,
  payload: string
): Promise<ApnsResult> {
  return new Promise((resolve, reject) => {
    let status = 0;
    let responseBody = '';
    const request = session.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': config.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json'
    });

    request.setEncoding('utf8');
    request.on('response', (headers) => {
      status = Number(headers[':status'] || 0);
    });
    request.on('data', (chunk: string) => {
      responseBody += chunk;
    });
    request.on('end', () => {
      let reason = '';
      try {
        reason = String(JSON.parse(responseBody || '{}').reason || '');
      } catch {
        reason = '';
      }
      resolve({ token, status, reason });
    });
    request.on('error', reject);
    request.end(payload);
  });
}

export class NotificationService {
  /**
   * Registra uma notificação no centro in-app e tenta entregá-la a todos os
   * dispositivos do usuário. Falha de push nunca impede a notificação in-app.
   */
  async notify(payload: NotificationPayload): Promise<void> {
    const userId = text(payload.userId, 256);
    const title = text(payload.title, 300);
    const message = text(payload.message || payload.body, 2000);
    const type = text(payload.type || 'system', 64) || 'system';
    const actionUrl = text(payload.actionUrl, 512) || undefined;

    if (!userId || !title) {
      console.warn('[NotificationService] notify() chamado sem userId/title, ignorando.');
      return;
    }

    const notification = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      title,
      message,
      type,
      read: false,
      createdAt: new Date().toISOString(),
      ...(actionUrl ? { actionUrl } : {})
    };
    const userRef = db.collection('users').doc(userId);
    let fcmTokens: string[] = [];
    let apnsTokens: string[] = [];

    try {
      await db.runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(userRef);
        if (!snapshot.exists) return;
        const current = snapshot.data() || {};
        fcmTokens = Array.isArray(current.fcmTokens)
          ? current.fcmTokens.filter((item: unknown): item is string => typeof item === 'string').slice(-MAX_PUSH_TOKENS)
          : [];
        apnsTokens = Array.isArray(current.apnsTokens)
          ? current.apnsTokens.filter((item: unknown): item is string => typeof item === 'string' && /^[A-Fa-f0-9]{64,256}$/.test(item)).slice(-MAX_PUSH_TOKENS)
          : [];
        const stored = Array.isArray(current.notifications) ? current.notifications : [];
        transaction.set(userRef, {
          notifications: [notification, ...stored].slice(0, MAX_STORED_NOTIFICATIONS)
        }, { merge: true });
      });
    } catch (error: any) {
      console.error(`[NotificationService] Falha ao gravar notificação in-app para ${userId}: ${error?.message || 'erro desconhecido'}`);
    }

    await Promise.all([
      fcmTokens.length > 0
        ? this.sendFcmPush(userId, fcmTokens, title, message, actionUrl, payload.data)
        : Promise.resolve(),
      apnsTokens.length > 0
        ? this.sendApnsPush(userId, apnsTokens, title, message, actionUrl, payload.data)
        : Promise.resolve()
    ]);
  }

  private async sendFcmPush(
    userId: string,
    tokens: string[],
    title: string,
    body: string,
    actionUrl?: string,
    data?: NotificationPayload['data']
  ): Promise<void> {
    try {
      const messaging = getMessaging(app);
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: {
          ...sanitizePushData(data),
          ...(actionUrl ? { actionUrl } : {})
        }
      });

      const deadTokens: string[] = [];
      response.responses.forEach((result: any, index: number) => {
        if (result.success) return;
        const code = String(result.error?.code || '');
        if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
          deadTokens.push(tokens[index]);
        }
      });

      if (deadTokens.length > 0) {
        await db.collection('users').doc(userId).set(
          { fcmTokens: FieldValue.arrayRemove(...deadTokens) },
          { merge: true }
        );
      }
      console.log(`[NotificationService] FCM ${response.successCount}/${tokens.length} enviado(s) para ${userId}.`);
    } catch (error: any) {
      console.error(`[NotificationService] Falha no push FCM para ${userId}: ${error?.message || 'erro desconhecido'}`);
    }
  }

  private async sendApnsPush(
    userId: string,
    tokens: string[],
    title: string,
    body: string,
    actionUrl?: string,
    data?: NotificationPayload['data']
  ): Promise<void> {
    const config = getApnsConfig();
    if (!config) {
      // Não caímos para FCM: um token APNs ali não é válido e só causa falha
      // silenciosa. A configuração é opcional em desenvolvimento, obrigatória
      // antes de publicar o push nativo iOS.
      console.warn('[NotificationService] Token(s) APNs registrado(s), mas as variáveis APNS_* não estão configuradas.');
      return;
    }

    const payload = createApnsPayload(title, body, actionUrl, data);
    if (!payload) {
      console.error('[NotificationService] Payload APNs excede o limite aceito.');
      return;
    }

    let session: http2.ClientHttp2Session | null = null;
    try {
      const jwt = createApnsJwt(config);
      session = http2.connect(config.endpoint);
      session.on('error', (error) => {
        console.error(`[NotificationService] Conexão APNs falhou: ${error.message}`);
      });

      const results = await Promise.all(tokens.map((token) => sendApnsRequest(session!, config, jwt, token, payload)));
      const deadTokens = results
        .filter(({ status, reason }) => status === 410 || (status === 400 && reason === 'BadDeviceToken'))
        .map(({ token }) => token);

      if (deadTokens.length > 0) {
        await db.collection('users').doc(userId).set(
          { apnsTokens: FieldValue.arrayRemove(...deadTokens) },
          { merge: true }
        );
      }

      const delivered = results.filter(({ status }) => status >= 200 && status < 300).length;
      console.log(`[NotificationService] APNs ${delivered}/${tokens.length} enviado(s) para ${userId}.`);
    } catch (error: any) {
      console.error(`[NotificationService] Falha no push APNs para ${userId}: ${error?.message || 'erro desconhecido'}`);
    } finally {
      session?.close();
    }
  }

  /** Mantido para serviços legados de validação de atividade. */
  async send(notification: {
    userId: string;
    title: string;
    body: string;
    type: string;
    data?: Record<string, string | number | boolean>;
  }): Promise<void> {
    await this.notify({
      userId: notification.userId,
      title: notification.title,
      message: notification.body,
      type: notification.type,
      data: notification.data
    });
  }
}

export const notificationService = new NotificationService();
