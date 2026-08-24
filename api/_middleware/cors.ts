import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';

export function corsMiddleware(req: VercelRequest, res: VercelResponse): boolean {
  return cors(req, res);
}
