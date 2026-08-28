import { VercelRequest, VercelResponse } from '@vercel/node';
import { corsMiddleware } from '../_middleware/cors.js';
import { methodMiddleware } from '../_middleware/method.js';
import { authMiddleware } from '../_middleware/auth.js';
import { errorHandler, AppError } from '../_middleware/error.js';
import { RunningRepository } from '../_repositories/running-repository.js';
import { RunningService } from '../_services/running/running-service.js';

const runningRepository = new RunningRepository();
const runningService = new RunningService(runningRepository);

// #96: a acao 'add' (e a rota irma /activities/running, que so existia pra
// forcar essa mesma acao) foram removidas -- eram uma 5a formula de
// pontuacao paralela (RunningService.addRun: XP proprio via
// processRunTransaction, check-in de presenca proprio, e a colecao
// `running_stats` como estado paralelo), ja substituida pelo IGA como fonte
// unica (ver AUDITORIA-CORE-INVICTUS.md e Fase 2 da auditoria 2026-08).
// Confirmado sem nenhum chamador vivo: o unico componente que usava
// runningService.addRun() (RunTracker.tsx) nunca era importado/renderizado
// em lugar nenhum do app, e /activities/running nunca era chamada pelo
// frontend. As leituras (me/ranking/history) continuam servindo dados
// historicos legados da colecao `running_stats`/`run_sessions` -- por isso
// ficam.
export default async function handler(req: VercelRequest & { userId?: string }, res: VercelResponse) {
  try {
    // 1. Middlewares
    if (corsMiddleware(req, res)) return;
    if (!methodMiddleware(req, res, ['GET', 'POST'])) return;

    const action = ((req.query.action as string) || req.body?.action || 'me').toLowerCase();

    // Sensitive actions require authentication
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
        const period = (req.query.period as 'month' | 'week') || 'month';
        const mode = (req.query.mode as 'official' | 'demo') || 'official';
        const ranking = await runningService.getRanking(period, mode, currentUserId);
        return res.status(200).json(ranking);
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
