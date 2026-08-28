import { Capacitor } from '@capacitor/core';
// #12: importado via alias npm 'capgo-capacitor-health' (aponta pro mesmo
// pacote @capgo/capacitor-health), NAO pelo nome real do pacote. Motivo,
// em 2 rodadas de erro real no Codemagic:
//
// 1ª falha: "Conflicting identity for capacitor-health" -- o SPM usa o
// ULTIMO SEGMENTO DO CAMINHO local (node_modules/<pasta>) como identidade
// de pacote quando referenciado por path, e o npm instala
// "@capgo/capacitor-health" numa pasta cujo ultimo segmento e literalmente
// "capacitor-health", igual a pasta do plugin do mley. Tentativa 1 usou o
// alias 'capgo-health-vitals' pra resolver isso.
//
// 2ª falha (causada pela tentativa 1): "product 'CapgoHealthVitals' ...
// not found in package 'CapgoHealthVitals'". O `cap sync ios` do Capacitor
// gera o Package.swift agregador (CapApp-SPM) assumindo, por CONVENCAO,
// que o nome do "product" de cada plugin e o PascalCase do nome da
// dependencia local no package.json -- ele nao le o Package.swift real do
// plugin pra descobrir o nome verdadeiro. 'capgo-health-vitals' virou
// "CapgoHealthVitals", mas o product real dentro do pacote da Capgo se
// chama "CapgoCapacitorHealth" (conferido no Package.swift oficial,
// Cap-go/capacitor-health) -- descasou.
//
// Fix: o alias tem que ser o PascalCase EXATO do product real, então usei
// 'capgo-capacitor-health' (-> "CapgoCapacitorHealth"), que também
// continua com ultimo segmento diferente de "capacitor-health" (resolve a
// 1ª falha) e agora bate com o nome real do product (resolve a 2ª).
import { Health as CapgoHealth } from 'capgo-capacitor-health';

// #253: leitura de METRICAS PASSIVAS (FC repouso, HRV, sono, peso) via
// @capgo/capacitor-health -- plugin DIFERENTE do "capacitor-health" (mley)
// usado por AppleHealthProvider/HealthConnectProvider para treinos.
//
// Por que dois plugins em vez de trocar um pelo outro: o Capgo tem API mais
// limpa e cobre HRV/FC repouso/sono/peso, que o mley nunca exps -- mas o
// `queryWorkouts()` do Capgo NAO devolve rota GPS nem serie de FC por treino
// (confirmado na definicao oficial do plugin, tipo `Workout` sem campos
// `route`/`heartRate`). O mley devolve os dois (`w.route`, `w.heartRate`),
// e e exatamente disso que o antifraude depende pra nao tratar toda corrida
// de wearable como "sem GPS" (fix #248). Trocar o mley pelo Capgo pra
// atividades regrediria o #248. Os dois plugins coexistem de proposito: mley
// = ingestao de treino (fetchActivities/querySessionMetrics, intocado),
// Capgo = vitais passivas (este arquivo, novo).
//
// Vitais aqui NAO alimentam o SecurityPipeline nem o IGA -- vao direto pra
// Health Data Layer (health_samples) via action 'sync-vitals'. Ver
// api/_lib/health-data-layer.ts::registrarAmostrasPassivas.

export type VitalMetricType = 'heart_rate_resting' | 'hrv_rmssd' | 'sleep_duration_min' | 'weight_kg' | 'steps_daily';

export interface VitalSample {
  metricType: VitalMetricType;
  value: number;
  unit: string;
  timestamp: string; // ISO -- momento real da leitura (nao o de sincronizacao)
  device?: string;
}

const READ_TYPES = ['restingHeartRate', 'heartRateVariability', 'sleep', 'weight', 'steps'] as const;

function isSupportedPlatform(): boolean {
  const plataforma = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && (plataforma === 'ios' || plataforma === 'android');
}

function valorValido(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0;
}

/**
 * Sono: HealthKit/Health Connect devolvem UM registro por SEGMENTO de estagio
 * (ex.: "asleep" das 23h as 23h40, "awake" das 23h40 as 23h45...), nunca um
 * total pronto. Somamos apenas os segmentos que representam sono real
 * (tudo exceto 'inBed'/'awake'), agrupados pela data (AAAA-MM-DD) do inicio
 * de cada segmento. Isso e uma simplificacao honesta, nao um calculo preciso
 * de "noite": uma sessao de sono que atravessa a meia-noite pode ficar
 * dividida entre duas datas. Preferimos essa aproximacao documentada a
 * inventar uma logica de fuso/corte-as-18h sem confirmar com dado real de
 * device.
 */
function agruparSonoPorNoite(samples: Array<{ sleepState?: string; startDate: string; endDate: string; sourceName?: string }>): VitalSample[] {
  const porNoite = new Map<string, { minutos: number; ultimaAmostra: string; device?: string }>();
  for (const s of samples) {
    if (s.sleepState === 'awake' || s.sleepState === 'inBed') continue;
    const inicio = new Date(s.startDate).getTime();
    const fim = new Date(s.endDate).getTime();
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) continue;
    const minutos = (fim - inicio) / 60000;
    const chave = s.startDate.slice(0, 10);
    const atual = porNoite.get(chave) || { minutos: 0, ultimaAmostra: s.endDate, device: s.sourceName };
    atual.minutos += minutos;
    if (s.endDate > atual.ultimaAmostra) atual.ultimaAmostra = s.endDate;
    porNoite.set(chave, atual);
  }
  const resultado: VitalSample[] = [];
  for (const [, dados] of porNoite) {
    if (dados.minutos <= 0) continue;
    resultado.push({
      metricType: 'sleep_duration_min',
      value: Math.round(dados.minutos),
      unit: 'min',
      timestamp: dados.ultimaAmostra,
      device: dados.device
    });
  }
  return resultado;
}

export const HealthVitalsProvider = {
  async isAvailable(): Promise<boolean> {
    if (!isSupportedPlatform()) return false;
    try {
      const { available } = await CapgoHealth.isAvailable();
      return available;
    } catch (error) {
      console.warn('[HealthVitalsProvider] isAvailable falhou:', error);
      return false;
    }
  },

  async requestPermissions(): Promise<boolean> {
    if (!isSupportedPlatform()) return false;
    try {
      const status = await CapgoHealth.requestAuthorization({ read: [...READ_TYPES] });
      // Assim como no HealthKit do mley, o iOS nao confirma negacao de
      // leitura com certeza -- so tratamos como concedido se pelo menos um
      // tipo apareceu como autorizado.
      return Array.isArray(status.readAuthorized) && status.readAuthorized.length > 0;
    } catch (error) {
      console.error('[HealthVitalsProvider] Erro ao solicitar permissões:', error);
      return false;
    }
  },

  async fetchVitals(since: Date): Promise<VitalSample[]> {
    if (!isSupportedPlatform()) return [];
    const startDate = since.toISOString();
    const endDate = new Date().toISOString();
    const amostras: VitalSample[] = [];

    try {
      const { samples } = await CapgoHealth.readSamples({ dataType: 'restingHeartRate', startDate, endDate, limit: 200, ascending: true });
      for (const s of samples || []) {
        if (!valorValido(s.value)) continue;
        amostras.push({ metricType: 'heart_rate_resting', value: Math.round(s.value), unit: 'bpm', timestamp: s.startDate, device: s.sourceName });
      }
    } catch (error) {
      console.warn('[HealthVitalsProvider] Falha ao ler restingHeartRate:', error);
    }

    try {
      const { samples } = await CapgoHealth.readSamples({ dataType: 'heartRateVariability', startDate, endDate, limit: 200, ascending: true });
      for (const s of samples || []) {
        if (!valorValido(s.value)) continue;
        amostras.push({ metricType: 'hrv_rmssd', value: Math.round(s.value), unit: 'ms', timestamp: s.startDate, device: s.sourceName });
      }
    } catch (error) {
      console.warn('[HealthVitalsProvider] Falha ao ler heartRateVariability:', error);
    }

    try {
      const { samples } = await CapgoHealth.readSamples({ dataType: 'weight', startDate, endDate, limit: 100, ascending: true });
      for (const s of samples || []) {
        if (!valorValido(s.value)) continue;
        amostras.push({ metricType: 'weight_kg', value: Math.round(s.value * 10) / 10, unit: 'kg', timestamp: s.startDate, device: s.sourceName });
      }
    } catch (error) {
      console.warn('[HealthVitalsProvider] Falha ao ler weight:', error);
    }

    try {
      const { samples } = await CapgoHealth.readSamples({ dataType: 'sleep', startDate, endDate, limit: 500, ascending: true });
      amostras.push(...agruparSonoPorNoite(samples || []));
    } catch (error) {
      console.warn('[HealthVitalsProvider] Falha ao ler sleep:', error);
    }

    // Passos: usamos queryAggregated (bucket=day, sum) em vez de somar
    // amostras cruas -- e o metodo que o proprio plugin recomenda pra volume
    // alto de dados (steps gera muitas amostras por dia) e evita duplicar
    // contagem se duas fontes reportarem o mesmo intervalo.
    try {
      const { samples } = await CapgoHealth.queryAggregated({ dataType: 'steps', startDate, endDate, bucket: 'day', aggregation: 'sum' });
      for (const s of samples || []) {
        if (!valorValido(s.value)) continue;
        amostras.push({ metricType: 'steps_daily', value: Math.round(s.value), unit: 'passos', timestamp: s.endDate });
      }
    } catch (error) {
      console.warn('[HealthVitalsProvider] Falha ao ler steps agregados:', error);
    }

    return amostras;
  }
};
