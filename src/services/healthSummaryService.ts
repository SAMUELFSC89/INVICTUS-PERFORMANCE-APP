import { auth } from '../firebase';
import { API_CONFIG } from '../config';

// #253: leitura da Health Data Layer (health_samples) pra tela "Saúde"
// (RESUMO). Puramente leitura -- nenhuma relação com IGA/ranking/pontuação,
// nenhuma escrita. Ver api/_handlers/health-summary.ts.

export type ResumoMetricType = 'heart_rate_resting' | 'hrv_rmssd' | 'sleep_duration_min' | 'steps_daily' | 'weight_kg';

export interface UltimoValorMetrica {
  value: number;
  unit: string;
  timestamp: string;
}

export interface HealthSummaryResponse {
  latest: Partial<Record<ResumoMetricType, UltimoValorMetrica | null>>;
  trends: {
    calories_active: Array<{ timestamp: string; value: number }>;
    hrv_rmssd: Array<{ timestamp: string; value: number }>;
    heart_rate_resting: Array<{ timestamp: string; value: number }>;
    sleep_duration_min: Array<{ timestamp: string; value: number }>;
  };
}

const EMPTY_RESPONSE: HealthSummaryResponse = {
  latest: {},
  trends: { calories_active: [], hrv_rmssd: [], heart_rate_resting: [], sleep_duration_min: [] }
};

export const healthSummaryService = {
  async fetchSummary(): Promise<HealthSummaryResponse> {
    const user = auth.currentUser;
    if (!user) return EMPTY_RESPONSE;
    try {
      const idToken = await user.getIdToken();
      const base = API_CONFIG.baseUrl || '';
      const res = await fetch(`${base}/api/health-summary`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      if (!res.ok) {
        console.warn('[healthSummaryService] Falha ao carregar resumo de saúde:', res.status);
        return EMPTY_RESPONSE;
      }
      const data = await res.json();
      return {
        latest: data?.latest || {},
        trends: {
          calories_active: Array.isArray(data?.trends?.calories_active) ? data.trends.calories_active : [],
          hrv_rmssd: Array.isArray(data?.trends?.hrv_rmssd) ? data.trends.hrv_rmssd : [],
          heart_rate_resting: Array.isArray(data?.trends?.heart_rate_resting) ? data.trends.heart_rate_resting : [],
          sleep_duration_min: Array.isArray(data?.trends?.sleep_duration_min) ? data.trends.sleep_duration_min : []
        }
      };
    } catch (error) {
      console.warn('[healthSummaryService] Erro de rede ao carregar resumo de saúde:', error);
      return EMPTY_RESPONSE;
    }
  }
};
