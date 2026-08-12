
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function test() {
  const pid = 'ais-us-east1-1124432a1c8741b0b';
  try {
    console.log(`Testing Metadata PID: ${pid}`);
    const app = initializeApp({ projectId: pid }, 'metadata-test');
    const db = getFirestore(app);
    const collections = await db.listCollections();
    console.log(`SUCCESS with PID: ${pid}. Collections: ${collections.length}`);
    await deleteApp(app);
  } catch (e: any) {
    console.log(`FAILED with PID ${pid}: ${e.message.split('\n')[0]}`);
  }
}

test();
