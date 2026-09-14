import { randomBytes } from 'node:crypto';
import { db } from './common.js';

export interface ShareGrant {
  token: string;
  activityId: string;
  userId: string;
  revokedAt?: string | null;
}

export async function createActivityShareGrant(userId: string, activityId: string): Promise<ShareGrant> {
  const activity = await db.collection('workouts').doc(activityId).get();
  if (!activity.exists || activity.data()?.userId !== userId) {
    throw new Error('Atividade não encontrada para compartilhamento.');
  }

  const token = randomBytes(24).toString('base64url');
  const now = new Date().toISOString();
  await db.collection('activity_share_grants').doc(token).set({
    token,
    activityId,
    userId,
    createdAt: now,
    revokedAt: null,
  });
  return { token, activityId, userId, revokedAt: null };
}

export async function resolveActivityShareGrant(token: string): Promise<ShareGrant | null> {
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(token)) return null;
  const snap = await db.collection('activity_share_grants').doc(token).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (data.revokedAt || !data.activityId || !data.userId) return null;
  return { token, activityId: String(data.activityId), userId: String(data.userId), revokedAt: null };
}
