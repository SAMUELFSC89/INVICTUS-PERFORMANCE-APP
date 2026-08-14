import { VercelRequest, VercelResponse } from '@vercel/node';
import { runDailySeasonCheck } from '../_lib/season-prize-engine.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
return res.status(401).json({ success: false, message: 'CRON_SECRET not configured on server' });
}

const authHeader = req.headers['authorization'];
const customSecretHeader = req.headers['x-cron-secret'];
const providedSecret = authHeader?.startsWith('Bearer ')
? authHeader.slice(7).trim()
: ((customSecretHeader as string) || (authHeader as string) || '').trim();

if (!providedSecret || providedSecret !== cronSecret) {
return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or missing secret header' });
}

try {
const result = await runDailySeasonCheck();
return res.status(200).json({ success: true, result });
} catch (error: any) {
console.error('[SEASON_PAYOUT_CRON] Error running season payout check:', error);
return res.status(500).json({ success: false, message: error?.message || 'Internal error' });
}
}
