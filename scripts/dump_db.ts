
import { db } from '../api/_lib/common';

async function dumpCollection(name) {
  console.log(`--- ${name} ---`);
  const snap = await db.collection(name).get();
  console.log(`Total documents: ${snap.size}`);
  snap.forEach(doc => {
    console.log(JSON.stringify({ id: doc.id, ...doc.data() }, null, 2));
  });
}

async function main() {
  await dumpCollection('user_elite_challenges');
  await dumpCollection('seasons');
}

main().catch(console.error);
