
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function test() {
  const pids = ['gen-lang-client-0890994677'];
  const dbId = 'ai-studio-42777a57-821e-48f8-9e9d-06c615ecdcda';

  for (const pid of pids) {
    try {
      console.log(`Testing PID: ${pid}`);
      const app = initializeApp({ projectId: pid }, pid);
      const db = getFirestore(app, dbId);
      
      // Try hitting a collection that IS in firestore.rules
      console.log('Attempting to list gyms...');
      const snap = await db.collection('gyms').limit(1).get();
      console.log(`SUCCESS! Found ${snap.size} gyms.`);
      
      await deleteApp(app);
      process.exit(0);
    } catch (e: any) {
      console.log(`FAILED with PID ${pid}: ${e.message.split('\n')[0]}`);
    }
  }
}

test();
