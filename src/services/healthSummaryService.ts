import { auth } from '../firebase';
import { API_CONFIG } from '../config';

// #253/#54: leitura da Health Data Layer (health_samples) pra tela "Saúde"
// (RESUMO) e pro relatório "Saúde & Performance". Puramente leitura --
// nenhuma relação com IGA/ranking/pontuação, nenhuma escrita.
// Ver api/_handlers/health-summary.ts.

export type ResumoMetricType =
  | 'heart_rate' | 'heart_rate_resting' | 'hrv_rmssd' | 'sleep_duration_min' | 'steps_daily' | 'weight_kg'
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
}

export interface HealthSummaryResponse {
  windowDays: number;
  latest: Partial<Record<ResumoMetricType, UltimoValorMetrica | null>>;
  trends: Partial<Record<TendenciaMetricType, PontoTendencia[]>>;
}

function respostaVazia(dias: number): HealthSummaryResponse {
  return { windowDays: dias, latest: {}, trends: {} };
}

export const healthSummaryService = {
  async fetchSummary(days = 30): Promise<HealthSummaryResponse> {
    const user = auth.currentUser;
    if (!user) return respostaVazia(days);
    try {
      const idToken = await user.getIdToken();
      const base = API_CONFIG.baseUrl || '';
      const res = await fetch(`${base}/api/health-summary?days=${days}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      if (!res.ok) {
        console.warn('[healthSummaryService] Falha ao carregar resumo de saúde:', res.status);
        return respostaVazia(days);
      }
      const data = await res.json();
      return {
        windowDays: Number(data?.windowDays) || days,
        latest: data?.latest || {},
        trends: data?.trends || {}
      };
    } catch (error) {
      console.warn('[healthSummaryService] Erro de rede ao carregar resumo de saúde:', error);
      return respostaVazia(days);
    }
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
