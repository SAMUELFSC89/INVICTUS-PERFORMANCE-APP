import { randomBytes } from 'node:crypto';
import { db } from './common.js';

export type ShareActivitySource = 'workouts' | 'run_sessions';

export interface ShareGrant {
  token: string;
  activityId: string;
  userId: string;
  source: ShareActivitySource;
  revokedAt?: string | null;
}

async function ownedActivity(userId: string, activityId: string): Promise<{ source: ShareActivitySource } | null> {
  const workout = await db.collection('workouts').doc(activityId).get();
  if (workout.exists && workout.data()?.userId === userId) return { source: 'workouts' };

  const run = await db.collection('run_sessions').doc(activityId).get();
  if (run.exists && run.data()?.userId === userId) return { source: 'run_sessions' };
  return null;
}

export async function createActivityShareGrant(userId: string, activityId: string): Promise<ShareGrant> {
  const owned = await ownedActivity(userId, activityId);
  if (!owned) throw new Error('Atividade não encontrada para compartilhamento.');

  const token = randomBytes(24).toString('base64url');
  const now = new Date().toISOString();
  const grant: ShareGrant = {
    token,
    activityId,
    userId,
    source: owned.source,
    revokedAt: null,
  };
  await db.collection('activity_share_grants').doc(token).set({
    ...grant,
    createdAt: now,
  });
  return grant;
}

export async function resolveActivityShareGrant(token: string): Promise<ShareGrant | null> {
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(token)) return null;
  const snap = await db.collection('activity_share_grants').doc(token).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (data.revokedAt || !data.activityId || !data.userId) return null;
  const source: ShareActivitySource = data.source === 'run_sessions' ? 'run_sessions' : 'workouts';
  return {
    token,
    activityId: String(data.activityId),
    userId: String(data.userId),
    source,
    revokedAt: null,
  };
}

export async function revokeActivityShareGrant(userId: string, token: string): Promise<boolean> {
  const snap = await db.collection('activity_share_grants').doc(token).get();
  if (!snap.exists || snap.data()?.userId !== userId) return false;
  await snap.ref.set({ revokedAt: new Date().toISOString() }, { merge: true });
  return true;
}
