import { db } from '../api/_lib/common';

async function checkUser(uid: string) {
  const userSnap = await db.collection('users').doc(uid).get();
  console.log('--- USER DATA ---');
  console.log(JSON.stringify(userSnap.data(), null, 2));

  const statsSnap = await db.collection('running_stats').doc(uid).get();
  console.log('--- RUNNING STATS ---');
  console.log(JSON.stringify(statsSnap.data(), null, 2));

  const challengesSnap = await db.collection('user_elite_challenges').where('userId', '==', uid).get();
  console.log('--- USER ELITE CHALLENGES ---');
  console.log('Count:', challengesSnap.size);
  challengesSnap.forEach(d => console.log(JSON.stringify(d.data(), null, 2)));
}

// UID for samuelfsc89@gmail.com from metadata context or I'll just find it
async function findAndCheck() {
  const usersSnap = await db.collection('users').where('email', '==', 'samuelfsc89@gmail.com').get();
  if (usersSnap.empty) {
    console.log('User not found');
    return;
  }
  const uid = usersSnap.docs[0].id;
  await checkUser(uid);
}

findAndCheck();
