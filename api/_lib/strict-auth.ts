import type { VercelRequest } from '@vercel/node';
import { auth } from './common.js';
import { db } from './common.js';
import { isActiveAccountState } from './account-state.js';

export async function verifyStrictAuth(req: VercelRequest): Promise<{ uid: string; email?: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  try {
    const decoded = await auth().verifyIdToken(token, true);
    const profile = await db.collection('users').doc(decoded.uid).get();
    if (!profile.exists || !isActiveAccountState(profile.data())) return null;
    return { uid: decoded.uid, email: decoded.email };
  } catch (error: any) {
    console.warn(`[AUTH] [VERIFY_STRICT_TOKEN] [REJECTED] ${error?.message || 'falha de autenticação estrita'}`);
    return null;
  }
}
