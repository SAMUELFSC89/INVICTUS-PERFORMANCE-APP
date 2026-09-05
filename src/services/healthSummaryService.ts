import { auth } from '../firebase';
import { API_CONFIG } from '../config';

// #253/#54: leitura da Health Data Layer (health_samples) pra tela "Saúde"
// (RESUMO) e pro relatório "Saúde & Performance". Puramente leitura --
// nenhuma relação com IGA/ranking/pontuação, nenhuma escrita.
// Ver api/_handlers/health-summary.ts.

export type ResumoMetricType =
  | 'heart_rate' | 'heart_rate_resting' | 'hrv_rmssd' | 'hrv_sdnn' | 'sleep_duration_min' | 'steps_daily' | 'weight_kg'
  | 'calories_active' | 'distance_km' | 'respiratory_rate' | 'oxygen_saturation' | 'vo2max_estimate'
  | 'blood_pressure_systolic' | 'blood_pressure_diastolic' | 'body_fat_percent' | 'hydration_l';
export type TendenciaMetricType = ResumoMetricType | 'calories_total' | 'calories_basal' | 'distance_cycling_km' | 'duration_min' | 'exercise_duration_min' | 'stand_hours' | 'mindfulness_duration_min';

export interface UltimoValorMetrica {
  value: number;
  unit: string;
  timestamp: string;
  startDate?: string;
  endDate?: string;
  sampleId?: string;
  source?: string;
  device?: string;
  provenance?: {
    integration?: string; dataOrigin?: string; applicationName?: string; recordingMethod?: string;
    deviceManufacturer?: string; deviceModel?: string; deviceName?: string; deviceType?: string;
    hardwareVersion?: string; firmwareVersion?: string; softwareVersion?: string; localIdentifier?: string;
    sourceVersion?: string; sourceProductType?: string; sourceOperatingSystemVersion?: string; status?: string;
  };
  confidenceAtMeasurement?: HealthConfidenceView;
  currentEvidenceConfidence?: HealthConfidenceView;
  measurementContext?: string;
  localDate?: string;
}

export interface HealthConfidenceView {
  confidenceLevel: 'A' | 'B' | 'C' | 'D' | 'E'; confidenceScore: number; confidenceReason: string;
  limitations: string[]; evidenceReferences: Array<{ id: string; title: string; url?: string; scope: string }>;
  confidenceEngineVersion: string; measurementContext: string; provenanceStatus: string; assessedAt: string;
}

export interface PontoTendencia {
  timestamp: string;
  value: number;
  source: string;
  device?: string;
  confidenceAtMeasurement?: HealthConfidenceView;
  currentEvidenceConfidence?: HealthConfidenceView;
  localDate?: string;
  sampleCount?: number;
  aggregationMethod?: string;
  unit?: string;
  provenance?: UltimoValorMetrica['provenance'];
  measurementContext?: string;
}

export interface HealthSummaryResponse {
  windowDays: number;
  latest: Partial<Record<ResumoMetricType, UltimoValorMetrica | null>>;
  trends: Partial<Record<TendenciaMetricType, PontoTendencia[]>>;
  timeZone?: string;
  fetchedAt?: string;
  availability?: 'ready' | 'empty' | 'partial' | 'stale' | 'error';
  errorMessage?: string;
  metadata?: { partial: boolean; aggregation: 'daily'; metrics: Record<string, { partial: boolean; scannedCount: number; limit: number; excludedLegacyCount: number }> };
}

function respostaVazia(dias: number): HealthSummaryResponse {
  return { windowDays: dias, latest: {}, trends: {} };
}

const summaryCache = new Map<string, { value: HealthSummaryResponse; expiresAt: number }>();
const pendingSummaries = new Map<string, Promise<HealthSummaryResponse>>();
let cacheUserId: string | undefined;
let cacheVersion = 0;
const CACHE_TTL_MS = 60_000;

export const healthSummaryService = {
  invalidate() {
    cacheVersion += 1;
    summaryCache.clear();
    pendingSummaries.clear();
  },
  async fetchSummary(days = 30, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): Promise<HealthSummaryResponse> {
    const user = auth.currentUser;
    if (cacheUserId !== user?.uid) {
      this.invalidate();
      cacheUserId = user?.uid;
    }
    if (!user) return { ...respostaVazia(days), availability: 'error', errorMessage: 'Entre na sua conta para carregar seus dados.' };
    const windowDays = Math.min(90, Math.max(1, Math.round(days)));
    const key = `${user.uid}:${windowDays}:${timeZone}`;
    const cached = summaryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = pendingSummaries.get(key);
    if (pending) return pending;
    const version = cacheVersion;
    const request = (async (): Promise<HealthSummaryResponse> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
      const idToken = await user.getIdToken();
      const base = API_CONFIG.baseUrl || '';
      const res = await fetch(`${base}/api/health-summary?days=${windowDays}&timeZone=${encodeURIComponent(timeZone)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error('Não foi possível atualizar os dados de saúde. Tente novamente.');
      }
      const data = await res.json();
      const hasData = Object.values(data?.latest || {}).some(Boolean)
        || Object.values(data?.trends || {}).some((points) => Array.isArray(points) && points.length > 0);
      const value: HealthSummaryResponse = {
        ...data,
        windowDays: Number(data?.windowDays) || windowDays,
        latest: data?.latest || {},
        trends: data?.trends || {},
        timeZone,
        fetchedAt: new Date().toISOString(),
        availability: data?.metadata?.partial ? 'partial' : (hasData ? 'ready' : 'empty')
      };
      if (cacheVersion === version && auth.currentUser?.uid === user.uid) {
        if (summaryCache.size >= 8) summaryCache.delete(summaryCache.keys().next().value!);
        summaryCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return value;
      } catch {
        return cached
          ? { ...cached.value, availability: 'stale', errorMessage: 'Sem conexão com os dados atuais. Exibindo a última consulta desta sessão.' }
          : { ...respostaVazia(windowDays), timeZone, availability: 'error', errorMessage: 'Não foi possível carregar os dados. Verifique a conexão e tente novamente.' };
      } finally {
        clearTimeout(timeout);
      }
    })();
    pendingSummaries.set(key, request);
    try { return await request; }
    finally { if (pendingSummaries.get(key) === request) pendingSummaries.delete(key); }
  }
};

// #54: divide uma série temporal ao meio (cronologicamente) e retorna a
// média de cada metade -- usado nas comparações "antes → depois" do
// relatório (ex.: "FC repouso 67 → 61 bpm"). Retorna null quando não há
// pontos suficientes pra uma comparação minimamente honesta (menos de 2 em
// cada metade), em vez de inventar uma tendência a partir de amostra
// insuficiente.
export function mediaAntesDepois(pontos: PontoTendencia[]): { antes: number; depois: number } | null {
  if (pontos.length < 4) return null;
  const meio = Math.floor(pontos.length / 2);
  const primeira = pontos.slice(0, meio);
  const segunda = pontos.slice(meio);
  if (primeira.length < 2 || segunda.length < 2) return null;
  const media = (lista: PontoTendencia[]) => lista.reduce((soma, p) => soma + p.value, 0) / lista.length;
  return { antes: media(primeira), depois: media(segunda) };
}

// #54: % de dias do período com pelo menos uma amostra, por fonte --
// usado na página "Origem e cobertura" do relatório.
export function coberturaPorFonte(pontos: PontoTendencia[], windowDays: number): Array<{ source: string; percent: number }> {
  if (pontos.length === 0 || windowDays <= 0) return [];
  const diasPorFonte = new Map<string, Set<string>>();
  for (const ponto of pontos) {
    const dia = ponto.timestamp.slice(0, 10);
    if (!diasPorFonte.has(ponto.source)) diasPorFonte.set(ponto.source, new Set());
    diasPorFonte.get(ponto.source)!.add(dia);
  }
  return Array.from(diasPorFonte.entries())
    .map(([source, dias]) => ({ source, percent: Math.min(100, Math.round((dias.size / windowDays) * 100)) }))
    .sort((a, b) => b.percent - a.percent);
}
