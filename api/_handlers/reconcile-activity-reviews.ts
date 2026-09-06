import { VercelRequest, VercelResponse } from '@vercel/node';
import { corsMiddleware } from '../_middleware/cors.js';
import { methodMiddleware } from '../_middleware/method.js';
import { authMiddleware } from '../_middleware/auth.js';
import { reconcilePendingActivityReviews } from '../_lib/pending-review-reconciler.js';

/**
 * Reconciliador seguro acionável pelo próprio atleta. Ele só enxerga o UID
 * autenticado no Firebase e nunca recebe userId do cliente como autoridade.
 * Casos objetivos/erros técnicos podem sair automaticamente da fila; uma
 * decisão realmente ambígua continua aguardando revisão administrativa.
 */
export default async function handler(req: VercelRequest & { userId?: string }, res: VercelResponse) {
  if (corsMiddleware(req, res)) return;
  if (!methodMiddleware(req, res, ['POST'])) return;
  if (!(await authMiddleware(req, res))) return;

  const userId = String(req.userId || '').trim();
  if (!userId) return res.status(401).json({ success: false, message: 'Sessão inválida.' });

  try {
    const result = await reconcilePendingActivityReviews({ userId, limit: 25 });
    return res.status(200).json({
      success: true,
      checked: result.checked,
      resolved: result.resolved,
      securityRetried: result.securityRetried,
      manualReview: result.manualReview,
      technicalPending: result.technicalPending,
    });
  } catch (error: any) {
    console.error('[RECONCILE_ACTIVITY_REVIEWS] Falha:', error);
    return res.status(500).json({
      success: false,
      message: 'Não foi possível atualizar o estado das análises agora.',
    });
  }
}
