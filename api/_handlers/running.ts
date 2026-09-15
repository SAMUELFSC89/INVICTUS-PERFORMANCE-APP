import { VercelRequest, VercelResponse } from '@vercel/node';
import { corsMiddleware } from '../_middleware/cors.js';
import { methodMiddleware } from '../_middleware/method.js';
import { authMiddleware } from '../_middleware/auth.js';
import { errorHandler, AppError } from '../_middleware/error.js';
import { RunningRepository } from '../_repositories/running-repository.js';
import { RunningService } from '../_services/running/running-service.js';

const runningRepository = new RunningRepository();
const runningService = new RunningService(runningRepository);

// O antigo ranking global de corrida foi desativado. Ele lia `running_stats`,
// usava best_run_km_* e uma regra financeira histórica independente do IGA,
// além de não respeitar o opt-in do ranking da academia. A fonte competitiva
// canônica agora é exclusivamente /api/ranking + igaService.
//
// Mantemos somente `me` e `history` enquanto os dados históricos de corrida
// ainda forem necessários para compatibilidade/compartilhamento.
export default async function handler(req: VercelRequest & { userId?: string }, res: VercelResponse) {
  try {
    // 1. Middlewares
    if (corsMiddleware(req, res)) return;
    if (!methodMiddleware(req, res, ['GET', 'POST'])) return;

    const action = ((req.query.action as string) || req.body?.action || 'me').toLowerCase();

    // Dados históricos individuais sempre exigem autenticação.
    const sensitiveActions = ['me', 'history'];
    if (sensitiveActions.includes(action)) {
      if (!(await authMiddleware(req, res))) return;
    }

    // Security: Prevent accessing other users' private data
    const targetUserId = (req.query.userId as string) || (req.body?.userId as string) || req.userId;
    if (req.userId && targetUserId && targetUserId !== req.userId && sensitiveActions.includes(action)) {
      throw new AppError('Acesso negado. Você só pode acessar seus próprios dados.', 403);
    }

    const currentUserId = targetUserId || req.userId || '';

    // 2. Dispatch Action
    switch (action) {
      case 'me': {
        const stats = await runningService.getUserStats(currentUserId);
        return res.status(200).json(stats);
      }

      case 'ranking': {
        throw new AppError('Ranking de corrida legado desativado. Use o ranking IGA da academia.', 410);
      }

      case 'history': {
        const history = await runningService.getHistory(currentUserId);
        return res.status(200).json(history);
      }

      default:
        throw new AppError(`Ação de corrida '${action}' não reconhecida.`, 400);
    }
  } catch (error: any) {
    return errorHandler(error, res);
  }
}
