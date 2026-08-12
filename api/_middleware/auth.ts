import { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../_lib/common.js';

export async function authMiddleware(req: VercelRequest & { userId?: string; userEmail?: string }, res: VercelResponse): Promise<boolean> {
  const user = await verifyAuth(req);
  if (!user) {
    res.status(401).json({
      success: false,
      message: 'Não autorizado. Token de autenticação ausente ou inválido.'
    });
    return false;
  }
  req.userId = user.uid;
  req.userEmail = user.email;
  return true;
}
