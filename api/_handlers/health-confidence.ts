import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { SCIENTIFIC_REFERENCES } from '../_lib/health-evidence-registry.js';
import { declareUserDevice, getDeviceCatalog } from '../_lib/health-device-registry.js';
import { loadHealthConfidenceRuntime } from '../_lib/health-confidence-runtime.js';

function text(value: unknown, max = 120): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  if (req.method === 'GET') {
    const action = String(req.query?.action || 'methodology');
    if (action === 'catalog') return res.status(200).json({ catalog: await getDeviceCatalog() });
    const runtime = await loadHealthConfidenceRuntime();
    return res.status(200).json({
      methodology: {
        version: runtime.config.version, thresholds: runtime.config.thresholds,
        disclaimer: 'O nível representa confiança na medição, não precisão clínica, diagnóstico ou avaliação do seu estado de saúde.',
        references: SCIENTIFIC_REFERENCES, evidence: runtime.registry
      }
    });
  }

  if (req.method === 'POST' && req.body?.action === 'declare-device') {
    const integration = req.body?.integration === 'APPLE_HEALTH' ? 'APPLE_HEALTH' : req.body?.integration === 'HEALTH_CONNECT' ? 'HEALTH_CONNECT' : null;
    const brand = text(req.body?.brand);
    const model = text(req.body?.model);
    if (!integration || !brand || !model) return res.status(400).json({ error: 'Integração, marca e modelo são obrigatórios.' });
    const effectiveFrom = text(req.body?.effectiveFrom, 40) || new Date().toISOString();
    if (isNaN(new Date(effectiveFrom).getTime())) return res.status(400).json({ error: 'Data inicial inválida.' });
    try {
      const declaration = await declareUserDevice({
        userId: auth.uid, integration, brand, model, effectiveFrom,
        generation: text(req.body?.generation), dataOrigin: text(req.body?.dataOrigin, 200)
      });
      return res.status(201).json({ declaration });
    } catch {
      return res.status(503).json({ error: 'Não foi possível salvar a identificação do dispositivo agora.' });
    }
  }
  return res.status(405).json({ error: 'Método ou ação não permitidos.' });
}
