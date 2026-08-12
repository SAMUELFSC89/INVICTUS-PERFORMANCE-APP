
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function test() {
  const pid = 'ais-us-east1-1124432a1c8741b0b';
  const dbId = 'ai-studio-42777a57-821e-48f8-9e9d-06c615ecdcda';
  try {
    console.log(`Testing Metadata PID: ${pid} with DB: ${dbId}`);
    const app = initializeApp({ projectId: pid }, 'metadata-db-test');
    const db = getFirestore(app, dbId);
    const collections = await db.listCollections();
    console.log(`SUCCESS! Collections: ${collections.length}`);
    await deleteApp(app);
  } catch (e: any) {
    console.log(`FAILED: ${e.message.split('\n')[0]}`);
  }
}

test();
