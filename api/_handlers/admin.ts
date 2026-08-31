import { VercelRequest, VercelResponse } from '@vercel/node';
import { corsMiddleware } from '../_middleware/cors.js';
import { methodMiddleware } from '../_middleware/method.js';
import { authMiddleware } from '../_middleware/auth.js';
import { errorHandler, AppError } from '../_middleware/error.js';
import { db } from '../_lib/common.js';
import { logEvent } from '../_lib/observability.js';
import { AdminRepository } from '../_repositories/admin-repository.js';
import { AdminService } from '../_services/admin/admin-service.js';
import { resolveGymChampionshipReview } from '../_lib/championship-scoring-service.js';

const adminRepository = new AdminRepository();
const adminService = new AdminService(adminRepository);

export default async function handler(req: VercelRequest & { userId?: string; userEmail?: string }, res: VercelResponse) {
  try {
    // 1. Middlewares
    if (corsMiddleware(req, res)) return;
    if (!methodMiddleware(req, res, ['GET', 'POST', 'PUT'])) return;
    if (!(await authMiddleware(req, res))) return;

    // 2. Authorize Admin
    const userSnap = await db.collection('users').doc(req.userId!).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    // A autorização usa somente o papel persistido. Exceções por e-mail
    // espalhadas pelo código criavam dois modelos de permissão incompatíveis.
    const isAdmin = userData?.role === 'admin';

    if (!isAdmin) {
      await logEvent({
        severity: 'HIGH_RISK',
        category: 'system_logs',
        message: `Tentativa de acesso administrativo não autorizado por: ${req.userEmail || req.userId}`,
        userId: req.userId!,
        route: '/api/admin',
        details: { email: req.userEmail }
      });
      throw new AppError('Acesso negado. Esta rota é restrita a administradores.', 403);
    }

    // 3. Dispatch Action
    const action = (req.query.action || req.body?.action || 'metrics') as string;

    switch (action) {
      case 'metrics':
        return res.status(200).json(await adminService.getMetrics());

      case 'get-reward-economy-config': {
        const [economy, championship] = await Promise.all([
          db.collection('reward_coin_economy').doc('global').get(),
          db.collection('gym_championship_config').doc('global').get(),
        ]);
        return res.status(200).json({
          economy: { pilotUserLimit: 1000, missionMonthlyCap: null, globalIssuanceBudget: null, enforceGlobalBudget: false, ...(economy.data() || {}) },
          championship: { top1Prize: 2500, top2Prize: 1500, top3Prize: 1000, participationPrize: 50, ...(championship.data() || {}) },
        });
      }

      case 'update-reward-economy-config': {
        const numberOrNull = (value: unknown) => value === null || value === '' || value === undefined ? null : Math.max(0, Number(value) || 0);
        const economy = {
          pilotUserLimit: Math.max(1, Number(req.body?.pilotUserLimit) || 1000),
          missionMonthlyCap: numberOrNull(req.body?.missionMonthlyCap),
          globalIssuanceBudget: numberOrNull(req.body?.globalIssuanceBudget),
          enforceGlobalBudget: Boolean(req.body?.enforceGlobalBudget),
          updatedAt: new Date().toISOString(), updatedBy: req.userId,
        };
        const championship = {
          top1Prize: Math.max(0, Number(req.body?.top1Prize) || 2500),
          top2Prize: Math.max(0, Number(req.body?.top2Prize) || 1500),
          top3Prize: Math.max(0, Number(req.body?.top3Prize) || 1000),
          participationPrize: Math.max(0, Number(req.body?.participationPrize) || 50),
          updatedAt: new Date().toISOString(), updatedBy: req.userId,
        };
        await Promise.all([
          db.collection('reward_coin_economy').doc('global').set(economy, { merge: true }),
          db.collection('gym_championship_config').doc('global').set(championship, { merge: true }),
        ]);
        return res.status(200).json({ success: true, economy, championship });
      }

      case 'review-gym-championship-result': {
        const decision = String(req.body?.decision || '').toUpperCase();
        if (decision !== 'APPROVED' && decision !== 'REJECTED') throw new AppError('Decisão inválida.', 400);
        return res.status(200).json(await resolveGymChampionshipReview({
          resultId: String(req.body?.resultId || ''), decision, reviewerId: req.userId!, reason: String(req.body?.reason || ''),
        }));
      }

      case 'logs': {
        const category = (req.query.category as string) || 'system_logs';
        const limit = Number(req.query.limit || 20);
        return res.status(200).json(await adminService.getLogs(category, limit));
      }

      case 'review-activity': {
        const result = await adminService.reviewActivity(req.userId!, req.body);
        return res.status(200).json(result);
      }

      case 'list-flagged-activities': {
        const limit = Number(req.query.limit || 50);
        return res.status(200).json(await adminService.listFlaggedActivities(limit));
      }

      case 'list-withdrawals': {
        const status = req.query.status as string;
        return res.status(200).json(await adminService.listWithdrawals(status));
      }

      case 'update-withdrawal-status': {
        const { withdrawalId, status, reason } = req.body;
        const result = await adminService.updateWithdrawalStatus(req.userId!, withdrawalId, status, reason);
        return res.status(200).json(result);
      }

    case 'process-withdrawal-payment': {
      const { withdrawalId } = req.body;
      const result = await adminService.processWithdrawalPayment(req.userId!, withdrawalId);
      return res.status(200).json(result);
    }

          case 'credit-test-balance': {
const { userId, amount, description } = req.body;
const result = await adminService.creditTestBalance(req.userId!, userId || req.userId!, Number(amount), description);
return res.status(200).json(result);
}
case 'update-withdrawal-min-amount': {
const { minWithdrawalAmount } = req.body;
const result = await adminService.updateWithdrawalMinAmount(req.userId!, Number(minWithdrawalAmount));
return res.status(200).json(result);
}
case 'upsert-mission':
      case 'upsert-sponsor-challenge':
      case 'upsert-store-item': {
        const typeMap: Record<string, 'mission' | 'sponsor_challenge' | 'store_item'> = {
          'upsert-mission': 'mission',
          'upsert-sponsor-challenge': 'sponsor_challenge',
          'upsert-store-item': 'store_item'
        };
        const result = await adminService.upsertEntity(typeMap[action], req.body.id, req.body);
        return res.status(200).json(result);
      }

      case 'production-audit':
        return res.status(200).json(await adminService.getProductionAudit());

      case 'get-trace': {
        const traceId = (req.query.traceId || req.body?.traceId) as string;
        return res.status(200).json(await adminService.getTrace(traceId));
      }

      default:
        throw new AppError(`Ação administrativa '${action}' não reconhecida.`, 400);
    }
  } catch (error: any) {
    return errorHandler(error, res);
  }
}
