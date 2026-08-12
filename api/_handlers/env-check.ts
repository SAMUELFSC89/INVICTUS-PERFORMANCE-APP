import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, app } from '../_lib/common.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let firestoreTest = 'Not started';
  try {
    const snap = await db.collection('test').doc('ping').get();
    firestoreTest = `Success! Exists: ${snap.exists}`;
  } catch (e: any) {
    firestoreTest = `Failed: ${e.message}`;
  }

  return res.json({
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    PROJECT_ID: process.env.PROJECT_ID,
    FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
    NODE_ENV: process.env.NODE_ENV,
    GEMINI_KEY_PRESENT: !!process.env.GEMINI_API_KEY,
    GEMINI_KEY_LENGTH: process.env.GEMINI_API_KEY?.length || 0,
    firestoreTest,
    appProjectId: (app.options as any).projectId,
    appDatabaseId: (db as any).databaseId
  });
}
