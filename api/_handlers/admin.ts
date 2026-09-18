import { VercelRequest, VercelResponse } from '@vercel/node';
import { corsMiddleware } from '../_middleware/cors.js';
import { methodMiddleware } from '../_middleware/method.js';
import { authMiddleware } from '../_middleware/auth.js';
import { errorHandler, AppError } from '../_middleware/error.js';
import { auth as firebaseAdminAuth, db } from '../_lib/common.js';
import { logEvent } from '../_lib/observability.js';
import { AdminRepository } from '../_repositories/admin-repository.js';
import { AdminService } from '../_services/admin/admin-service.js';
import { resolveGymChampionshipReview } from '../_lib/championship-scoring-service.js';
import { hasActiveAdminAuthority } from '../_lib/admin-authority.js';
import { fixGymFromGoogle, runAdminGymAudit } from '../_lib/admin-gym-audit.js';
import { getPowerLiftReviewVideo, listPowerLiftReviews, reviewPowerLiftRecord } from '../_lib/powerlift-admin.js';

const adminRepository = new AdminRepository();
const adminService = new AdminService(adminRepository);

function isInactiveAccount(data: Record<string, any>): boolean {
  const terminalStates = new Set(['deleted', 'blocked', 'banned', 'suspended', 'account_deleted', 'deletion_completed']);
  const normalized = [data.status, data.accountStatus, data.lifecycleStatus]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  return Boolean(
    data.isBlocked === true
    || data.isBanned === true
    || data.isSuspended === true
    || data.isDeleted === true
    || data.deleted === true
    || data.accountDeleted === true
    || data.disabled === true
    || data.tombstone === true
    || data.deletedAt
    || data.accountDeletedAt
    || normalized.some((state) => terminalStates.has(state))
  );
}

export default async function handler(req: VercelRequest & { userId?: string; userEmail?: string }, res: VercelResponse) {
  try {
    if (corsMiddleware(req, res)) return;
    if (!methodMiddleware(req, res, ['GET', 'POST', 'PUT'])) return;
    if (!(await authMiddleware(req, res))) return;

    const userSnap = await db.collection('users').doc(req.userId!).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const isAdmin = hasActiveAdminAuthority(userData);

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

    const action = (req.query.action || req.body?.action || 'metrics') as string;

    switch (action) {
      case 'metrics':
        return res.status(200).json(await adminService.getMetrics());

      case 'set-user-role': {
        const targetUid = String(req.body?.targetUid || '').trim();
        const role = String(req.body?.role || '').trim().toLowerCase();
        if (!targetUid || targetUid.length > 128) throw new AppError('Usuário alvo inválido.', 400);
        if (role !== 'admin' && role !== 'user') throw new AppError('Papel inválido.', 400);
        if (targetUid === req.userId) throw new AppError('Você não pode alterar o próprio papel administrativo.', 400);

        const targetRef = db.collection('users').doc(targetUid);
        const targetSnap = await targetRef.get();
        if (!targetSnap.exists) throw new AppError('Usuário não encontrado.', 404);
        const targetData = targetSnap.data() || {};

        if (role === 'admin') {
          const tombstone = await db.collection('deleted_users').doc(targetUid).get();
          if (tombstone.exists || isInactiveAccount(targetData)) {
            throw new AppError('Uma conta bloqueada, suspensa ou excluída não pode receber acesso administrativo.', 409);
          }
        }

        const previousRole = targetData.role === 'admin' ? 'admin' : 'user';
        if (previousRole !== role) {
          await targetRef.update({
            role,
            isAdmin: role === 'admin',
            adminRoleUpdatedAt: new Date().toISOString(),
            adminRoleUpdatedBy: req.userId,
          });
        }

        await logEvent({
          severity: 'HIGH_RISK',
          category: 'system_logs',
          message: `Papel administrativo alterado de '${previousRole}' para '${role}'.`,
          userId: targetUid,
          route: '/api/admin?action=set-user-role',
          details: { targetUid, previousRole, role, changedBy: req.userId },
        });

        return res.status(200).json({ success: true, targetUid, role, previousRole });
      }

      case 'gyms-audit': {
        const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
        return res.status(200).json(await runAdminGymAudit(limit));
      }

      case 'fix-gym-coordinates': {
        const gymId = String(req.body?.gymId || '').trim();
        if (!gymId) throw new AppError('gymId é obrigatório.', 400);
        try {
          const result = await fixGymFromGoogle(gymId, req.userId!);
          await logEvent({
            severity: 'INFO',
            category: 'admin_reviews',
            message: `Cadastro canônico da academia ${gymId} sincronizado com Google Places.`,
            userId: req.userId!,
            route: '/api/admin?action=fix-gym-coordinates',
            details: { gymId, affectedUsers: result.affectedUsers },
          });
          return res.status(200).json(result);
        } catch (error: any) {
          throw new AppError(String(error?.message || 'Não foi possível corrigir a academia.'), 409);
        }
      }

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

      case 'list-powerlift-reviews': {
        const status = String(req.query.status || 'manual_review');
        const limit = Number(req.query.limit || 50);
        return res.status(200).json(await listPowerLiftReviews(status, limit));
      }

      case 'get-powerlift-review-video': {
        const recordId = String(req.query.recordId || req.body?.recordId || '');
        return res.status(200).json(await getPowerLiftReviewVideo(recordId));
      }

      case 'review-powerlift-record': {
        const recordId = String(req.body?.recordId || '');
        const decision = String(req.body?.decision || '').toLowerCase();
        if (decision !== 'approved' && decision !== 'rejected') throw new AppError('Decisão Power Lift inválida.', 400);
        return res.status(200).json(await reviewPowerLiftRecord(
          req.userId!,
          recordId,
          decision as 'approved' | 'rejected',
          String(req.body?.note || ''),
        ));
      }

      case 'delete-user': {
        const target = String(req.body?.target || '').trim();
        if (!target || target.length > 256) throw new AppError('Usuário inválido.', 400);

        const users = db.collection('users');
        const matches = new Map<string, any>();
        const direct = await users.doc(target).get();
        if (direct.exists) matches.set(direct.id, direct);

        const normalizedEmail = target.toLowerCase();
        if (target.includes('@')) {
          const byEmail = await users.where('email', '==', normalizedEmail).limit(10).get();
          byEmail.docs.forEach((document: any) => matches.set(document.id, document));
        }

        const normalizedCpf = target.replace(/\D/g, '');
        if (normalizedCpf.length === 11) {
          const byCpf = await users.where('cpf', '==', normalizedCpf).limit(10).get();
          byCpf.docs.forEach((document: any) => matches.set(document.id, document));
        }

        if (!matches.size) throw new AppError('Cadastro não encontrado.', 404);
        if (matches.has(req.userId!)) throw new AppError('Você não pode desativar a própria conta administrativa.', 400);

        const deletedAt = new Date().toISOString();
        const deletedUids: string[] = [];
        const identityWarnings: string[] = [];
        for (const [uid] of matches) {
          const userRef = users.doc(uid);
          const tombstoneRef = db.collection('deleted_users').doc(uid);
          await db.runTransaction(async (transaction: any) => {
            const current = await transaction.get(userRef);
            if (!current.exists) return;
            const existing = current.data() || {};
            transaction.set(tombstoneRef, {
              uid,
              deletedAt,
              deletedBy: req.userId,
              reason: 'ADMIN_ACCOUNT_DELETION',
            }, { merge: true });
            transaction.update(userRef, {
              role: 'user',
              isAdmin: false,
              accountStatus: 'deleted',
              status: 'deleted',
              isBlocked: true,
              isBanned: true,
              isSuspended: true,
              isSubscribed: false,
              isPro: false,
              premium: false,
              performance: false,
              subscriptionStatus: 'inactive',
              proStatus: 'revoked',
              proEntitlement: existing.proEntitlement && typeof existing.proEntitlement === 'object'
                ? { ...existing.proEntitlement, status: 'revoked', expiresAt: deletedAt, providerObservedAt: deletedAt }
                : { tier: 'performance', status: 'revoked', expiresAt: deletedAt, providerObservedAt: deletedAt },
              deletedAt,
              deletedBy: req.userId,
              updatedAt: deletedAt,
            });
          });
          deletedUids.push(uid);

          try {
            await firebaseAdminAuth().updateUser(uid, { disabled: true });
            await firebaseAdminAuth().revokeRefreshTokens(uid);
          } catch (error: any) {
            if (error?.code !== 'auth/user-not-found') {
              identityWarnings.push(uid);
              console.error(`[Admin] Conta ${uid} foi bloqueada no banco, mas a identidade não pôde ser desabilitada:`, error);
            }
          }
        }

        await logEvent({
          severity: 'HIGH_RISK',
          category: 'system_logs',
          message: `Administrador desativou ${deletedUids.length} conta(s).`,
          userId: req.userId!,
          route: '/api/admin?action=delete-user',
          details: { deletedUids, identityWarnings },
        });

        return res.status(200).json({
          success: true,
          deletedUids,
          identityWarnings,
          message: identityWarnings.length
            ? 'Conta bloqueada no aplicativo; a desativação da identidade exige revisão operacional.'
            : 'Conta desativada, sessões revogadas e tombstone de auditoria criado.',
        });
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

      case 'reconcile-withdrawal-provider': {
        const { withdrawalId } = req.body;
        const result = await adminService.reconcileWithdrawalProviderSubmission(req.userId!, withdrawalId);
        return res.status(200).json(result);
      }

      case 'update-withdrawal-min-amount': {
        const { minWithdrawalAmount } = req.body;
        const result = await adminService.updateWithdrawalMinAmount(req.userId!, Number(minWithdrawalAmount));
        return res.status(200).json(result);
      }

      case 'upsert-mission':
      case 'upsert-store-item': {
        const typeMap: Record<string, 'mission' | 'store_item'> = {
          'upsert-mission': 'mission',
          'upsert-store-item': 'store_item'
        };
        const result = await adminService.upsertEntity(typeMap[action], req.body.id, req.body);
        return res.status(200).json(result);
      }

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
