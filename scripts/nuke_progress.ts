
import { db } from '../api/_lib/common';

async function nukeAllProgress() {
  console.log('--- STARTING ABSOLUTE NUKE OF ALL PROGRESS ---');

  const collectionsToClear = [
    'activities',
    'workouts',
    'run_sessions',
    'running_stats',
    'user_elite_challenges',
    'elite_feed',
    'rankings',
    'aggregated_rankings',
    'notifications',
    'diets'
  ];

  for (const coll of collectionsToClear) {
    console.log(`Clearing ${coll}...`);
    const snap = await db.collection(coll).get();
    const batch = db.batch();
    snap.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`Cleared ${snap.size} documents from ${coll}.`);
  }

  console.log('Resetting all users to 0 score and unsubscribed...');
  const usersSnap = await db.collection('users').get();
  const userBatch = db.batch();
  usersSnap.forEach(doc => {
    userBatch.update(doc.ref, {
      score: 0,
      streak: 0,
      isSubscribed: false,
      level: 1,
      xp: 0
    });
  });
  await userBatch.commit();
  console.log(`Reset ${usersSnap.size} users.`);

  console.log('--- NUKE COMPLETE ---');
}

nukeAllProgress().catch(console.error);
