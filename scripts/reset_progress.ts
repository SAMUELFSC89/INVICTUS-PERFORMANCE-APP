import { db, FieldValue } from '../api/_lib/common';

async function resetAll() {
  console.log('--- STARTING DATABASE RESET ---');
  
  try {
    // 1. Reset Users Progress
    const usersSnap = await db.collection('users').get();
    console.log(`Found ${usersSnap.size} users.`);
    
    let userBatch = db.batch();
    let count = 0;
    
    for (const doc of usersSnap.docs) {
      userBatch.update(doc.ref, {
        score: 0,
        xp: 0,
        level: 1,
        weeklyScore: 0,
        monthlyScore: 0,
        streak: 0,
        totalActiveDays: 0,
        totalWorkouts: 0,
        totalTimeSpent: 0,
        achievements: [],
        firstScoreAt: FieldValue.delete(),
        lastCheckIn: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
      count++;
      if (count % 400 === 0) {
        await userBatch.commit();
        userBatch = db.batch();
      }
    }
    await userBatch.commit();
    console.log('Users progress reset completed.');

    // 2. Clear Collections
    const collectionsToClear = [
      'activities', 
      'workouts', 
      'run_sessions', 
      'run_sessions_archive', 
      'notifications', 
      'elite_feed',
      'user_elite_challenges'
    ];
    for (const collName of collectionsToClear) {
      console.log(`Clearing collection: ${collName}...`);
      const snap = await db.collection(collName).get();
      let deleteBatch = db.batch();
      let dCount = 0;
      for (const d of snap.docs) {
        deleteBatch.delete(d.ref);
        dCount++;
        if (dCount % 400 === 0) {
          await deleteBatch.commit();
          deleteBatch = db.batch();
        }
      }
      await deleteBatch.commit();
      console.log(`Cleared ${snap.size} documents from ${collName}.`);
    }

    // 3. Reset Running Stats (Keeping is_paid_running if they want to keep plan status, but resetting km)
    console.log('Resetting running_stats...');
    const statsSnap = await db.collection('running_stats').get();
    let statsBatch = db.batch();
    let sCount = 0;
    for (const doc of statsSnap.docs) {
      statsBatch.update(doc.ref, {
        best_run_km_month: 0,
        best_run_km_week: 0,
        last_run_stats: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
      sCount++;
      if (sCount % 400 === 0) {
        await statsBatch.commit();
        statsBatch = db.batch();
      }
    }
    await statsBatch.commit();
    console.log('Running stats reset completed.');

    console.log('--- DATABASE RESET COMPLETED SUCCESSFULLY ---');
    process.exit(0);
  } catch (error) {
    console.error('DATABASE RESET FAILED:', error);
    process.exit(1);
  }
}

resetAll();
