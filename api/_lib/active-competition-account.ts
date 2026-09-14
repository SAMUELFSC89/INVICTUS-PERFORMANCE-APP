import { db } from './common.js';
import { isActiveAccountState } from './account-state.js';

export async function isActiveCompetitiveAccount(userId: string): Promise<boolean> {
  if (!userId) return false;
  const snapshot = await db.collection('users').doc(userId).get();
  return snapshot.exists && isActiveAccountState(snapshot.data());
}

export async function filterActiveCompetitiveUserIds(userIds: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (!unique.length) return new Set();
  const refs = unique.map((userId) => db.collection('users').doc(userId));
  const snapshots = await db.getAll(...refs);
  return new Set(
    snapshots
      .filter((snapshot: any) => snapshot.exists && isActiveAccountState(snapshot.data()))
      .map((snapshot: any) => snapshot.id),
  );
}
