
import { db } from '../api/_lib/common';

async function checkCollections() {
  console.log('--- SEASONS ---');
  const seasonsSnap = await db.collection('seasons').get();
  seasonsSnap.forEach(doc => {
    console.log(JSON.stringify({ id: doc.id, ...doc.data() }, null, 2));
  });

  console.log('\n--- ACTIVE USER ELITE CHALLENGES ---');
  const userChallengesSnap = await db.collection('user_elite_challenges').where('currentKm', '>', 0).get();
  console.log(`Found ${userChallengesSnap.size} participating users with progress > 0`);
  userChallengesSnap.forEach(doc => {
    console.log(JSON.stringify({ id: doc.id, ...doc.data() }, null, 2));
  });

  console.log('\n--- RUNNING STATS WITH PROGRESS ---');
  const runningStatsSnap = await db.collection('running_stats').where('best_run_km_month', '>', 0).get();
  console.log(`Found ${runningStatsSnap.size} running stats with progress > 0`);
  runningStatsSnap.forEach(doc => {
    const data = doc.data();
    console.log(`User: ${data.userId}, Month KM: ${data.best_run_km_month}`);
  });
}

checkCollections().catch(console.error);
