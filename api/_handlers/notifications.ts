import { cors, verifyAuth } from '../_lib/common.js';
import { notificationService } from '../_services/notification-service.js';

/**
 * POST /api/notifications
 * Unified endpoint for a signed-in user to create a notification for himself.
 * Cross-user/system notifications must originate from trusted server-side
 * workflows, never from a browser token that could spam arbitrary accounts.
 *
 * Body: { recipientId: string, type: string, title: string, message: string, actionUrl?: string }
 */

const ALLOWED_TYPES = ['ranking', 'payment', 'system', 'achievement', 'social'];
const MAX_TEXT_LEN = 300;

export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { recipientId, type, title, message, actionUrl } = req.body || {};

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
