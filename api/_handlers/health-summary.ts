import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { lerSerieTemporalMetrica, HealthMetricType } from '../_lib/health-data-layer.js';

// #253: leitura para a tela "Saúde" (RESUMO). Só lê -- nenhuma escrita aqui,
// nenhuma relação com IGA/ranking/pontuação. Fonte real: health_samples,
// gravado por wearable-sync-service.ts (ligado a atividade) e pela action
// 'sync-vitals' de api/_handlers/wearables.ts (vitais passivas).

const METRICAS_RESUMO: HealthMetricType[] = [
  'heart_rate_resting', 'hrv_rmssd', 'sleep_duration_min', 'steps_daily', 'weight_kg'
];
// Um valor "atual" pode ter sido lido em qualquer sincronização recente --
// não exigimos leitura de hoje (o usuário pode não ter aberto o app desde
// ontem), mas não voltamos meses no tempo achando que uma leitura antiga
// ainda representa o estado "de agora".
const JANELA_ULTIMO_VALOR_DIAS = 14;
const JANELA_TENDENCIA_DIAS = 30;

interface UltimoValor {
  value: number;
  unit: string;
  timestamp: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const agora = new Date();
    const desdeUltimo = new Date(agora.getTime() - JANELA_ULTIMO_VALOR_DIAS * 24 * 60 * 60 * 1000);
    const desdeTendencia = new Date(agora.getTime() - JANELA_TENDENCIA_DIAS * 24 * 60 * 60 * 1000);

    const [ultimosPares, tendenciaCalorias, tendenciaHrv, tendenciaFcRepouso, tendenciaSono] = await Promise.all([
      Promise.all(METRICAS_RESUMO.map(async (tipo): Promise<[HealthMetricType, UltimoValor | null]> => {
        const amostras = await lerSerieTemporalMetrica(auth.uid, tipo, desdeUltimo, agora);
        const ultima = amostras[amostras.length - 1];
        return [tipo, ultima ? { value: ultima.value, unit: ultima.unit, timestamp: ultima.timestamp } : null];
      })),
      lerSerieTemporalMetrica(auth.uid, 'calories_active', desdeTendencia, agora),
      lerSerieTemporalMetrica(auth.uid, 'hrv_rmssd', desdeTendencia, agora),
      lerSerieTemporalMetrica(auth.uid, 'heart_rate_resting', desdeTendencia, agora),
      lerSerieTemporalMetrica(auth.uid, 'sleep_duration_min', desdeTendencia, agora)
    ]);

    const paraPontos = (amostras: Array<{ timestamp: string; value: number }>) =>
      amostras.map((a) => ({ timestamp: a.timestamp, value: a.value }));

    return res.status(200).json({
      latest: Object.fromEntries(ultimosPares),
      trends: {
        calories_active: paraPontos(tendenciaCalorias),
        hrv_rmssd: paraPontos(tendenciaHrv),
        heart_rate_resting: paraPontos(tendenciaFcRepouso),
        sleep_duration_min: paraPontos(tendenciaSono)
      }
    });
  } catch (err: any) {
    console.error('[HealthSummary Handler]:', err);
    return res.status(500).json({ error: 'Não foi possível carregar o resumo de saúde agora.' });
  }
}
