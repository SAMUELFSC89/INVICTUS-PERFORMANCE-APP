import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  return res.status(200).json({
    testPaymentMode: false
  });
}
