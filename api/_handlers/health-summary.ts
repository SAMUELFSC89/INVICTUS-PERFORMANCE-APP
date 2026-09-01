import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { lerSerieTemporalMetrica, HealthMetricType } from '../_lib/health-data-layer.js';
import { selectDailyHealthSource } from '../_lib/health-source-priority.js';

// #253: leitura para a tela "Saúde" (RESUMO) e o relatório "Saúde &
// Performance" (#54). Só lê -- nenhuma escrita aqui, nenhuma relação com
// IGA/ranking/pontuação. Fonte real: health_samples, gravado por
// wearable-sync-service.ts (ligado a atividade) e pela action 'sync-vitals'
// de api/_handlers/wearables.ts (vitais passivas).

const METRICAS_RESUMO: HealthMetricType[] = [
  'heart_rate', 'heart_rate_resting', 'hrv_rmssd', 'sleep_duration_min', 'steps_daily', 'weight_kg',
  'calories_active', 'distance_km', 'respiratory_rate', 'oxygen_saturation', 'vo2max_estimate',
  'blood_pressure_systolic', 'blood_pressure_diastolic', 'body_fat_percent', 'hydration_l'
];
const METRICAS_TENDENCIA: HealthMetricType[] = [
  ...METRICAS_RESUMO, 'calories_total', 'calories_basal', 'distance_cycling_km', 'duration_min',
  'exercise_duration_min', 'stand_hours', 'mindfulness_duration_min'
];
// Um valor "atual" pode ter sido lido em qualquer sincronização recente --
// não exigimos leitura de hoje (o usuário pode não ter aberto o app desde
// ontem), mas não voltamos meses no tempo achando que uma leitura antiga
// ainda representa o estado "de agora".
const JANELA_ULTIMO_VALOR_DIAS = 14;
const DIAS_TENDENCIA_PADRAO = 30;
const DIAS_TENDENCIA_MAXIMO = 90; // #54: página "Resumo para profissional" usa janela de 90 dias

interface UltimoValor {
  value: number;
  unit: string;
  timestamp: string;
  startDate?: string;
  endDate?: string;
  sampleId?: string;
  source?: string;
  device?: string;
}

interface PontoTendencia {
  timestamp: string;
  value: number;
  source: string;
}


export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });

  const diasSolicitados = Number(req.query?.days);
  const diasTendencia = Number.isFinite(diasSolicitados) && diasSolicitados > 0
    ? Math.min(diasSolicitados, DIAS_TENDENCIA_MAXIMO)
    : DIAS_TENDENCIA_PADRAO;

  try {
    const agora = new Date();
    const desdeUltimo = new Date(agora.getTime() - JANELA_ULTIMO_VALOR_DIAS * 24 * 60 * 60 * 1000);
    const desdeTendencia = new Date(agora.getTime() - diasTendencia * 24 * 60 * 60 * 1000);

    const [ultimosPares, tendenciaPares] = await Promise.all([
      Promise.all(METRICAS_RESUMO.map(async (tipo): Promise<[HealthMetricType, UltimoValor | null]> => {
        const amostras = selectDailyHealthSource(tipo, await lerSerieTemporalMetrica(auth.uid, tipo, desdeUltimo, agora));
        const ultima = amostras[amostras.length - 1];
        return [tipo, ultima ? {
          value: ultima.value, unit: ultima.unit, timestamp: ultima.timestamp,
          startDate: ultima.startDate, endDate: ultima.endDate, sampleId: ultima.sampleId,
          source: ultima.source, device: ultima.device
        } : null];
      })),
      Promise.all(METRICAS_TENDENCIA.map(async (tipo): Promise<[HealthMetricType, PontoTendencia[]]> => {
        const amostras = selectDailyHealthSource(tipo, await lerSerieTemporalMetrica(auth.uid, tipo, desdeTendencia, agora));
        return [tipo, amostras.map((a) => ({ timestamp: a.timestamp, value: a.value, source: a.source }))];
      }))
    ]);

    return res.status(200).json({
      windowDays: diasTendencia,
      latest: Object.fromEntries(ultimosPares),
      trends: Object.fromEntries(tendenciaPares)
    });
  } catch (err: any) {
    console.error('[HealthSummary Handler]:', err);
    return res.status(500).json({ error: 'Não foi possível carregar o resumo de saúde agora.' });
  }
}
