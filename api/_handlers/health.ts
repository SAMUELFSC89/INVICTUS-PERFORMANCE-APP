import { db, app, cors } from '../_lib/common.js';
import { getApps } from 'firebase-admin/app';

export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;

  const results: any = {
    status: "Healthy",
    timestamp: new Date().toISOString(),
    firebase: {
      projectId: app.options.projectId,
      initialized: getApps().length > 0,
      database: (db as any)._databaseId || 'default'
    }
  };

  try {
    // Only test DB if specifically requested via query to save quota
    if (req.query.full === 'true') {
      const testDoc = await db.collection("test").doc("ping").get();
      results.firestore = {
        connected: true,
        exists: testDoc.exists
      };
    } else {
      results.firestore = {
        connected: true,
        note: "Database check skipped (requested by default to save quota)"
      };
    }
  } catch (e: any) {
    results.firestore = {
      connected: false,
      error: e.message
    };
  }

  return res.status(200).json(results);
}
