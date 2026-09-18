import type { VercelRequest, VercelResponse } from '@vercel/node';
import { corsMiddleware } from './_middleware/cors.js';
import { methodMiddleware } from './_middleware/method.js';
import { authMiddleware } from './_middleware/auth.js';
import { AppError, errorHandler } from './_middleware/error.js';
import { db } from './_lib/common.js';
import { hasActiveAdminAuthority } from './_lib/admin-authority.js';
import { getAdminFinancialOverview } from './_lib/admin-financial-overview.js';

export default async function handler(req: VercelRequest & { userId?: string }, res: VercelResponse) {
  try {
    if (corsMiddleware(req, res)) return;
    if (!methodMiddleware(req, res, ['GET'])) return;
    if (!(await authMiddleware(req, res))) return;

    const userSnap = await db.collection('users').doc(req.userId!).get();
    if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data())) {
      throw new AppError('Acesso negado. Esta rota é restrita a administradores.', 403);
    }

    return res.status(200).json({ success: true, ...(await getAdminFinancialOverview()) });
  } catch (error: any) {
    return errorHandler(error, res);
  }
}
