
import { Firestore } from '@google-cloud/firestore';

async function test() {
  const projectId = 'gen-lang-client-0890994677';
  const databaseId = 'ai-studio-42777a57-821e-48f8-9e9d-06c615ecdcda';
  
  try {
    console.log(`Testing direct Firestore SDK. Project: ${projectId}, DB: ${databaseId}`);
    const firestore = new Firestore({
      projectId,
      databaseId,
    });
    
    const collections = await firestore.listCollections();
    console.log(`SUCCESS! Collections: ${collections.length}`);
  } catch (e: any) {
    console.log(`FAILED: ${e.message.split('\n')[0]}`);
  }
}

test();
