import { cors, verifyAuth } from '../_lib/common.js';

/** Compatibility tombstone for old installed clients. No mutations or data deletion. */
export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;
  if (!(await verifyAuth(req))) return res.status(401).json({ error: 'Autenticação necessária.' });
  return res.status(410).json({
    code: 'HABIT_FLOW_RETIRED',
    error: 'O fluxo antigo foi substituído por Buscar Objetivo. Seus registros anteriores foram preservados.',
    nextRoute: '/challenges/cardio/objective',
  });
}
