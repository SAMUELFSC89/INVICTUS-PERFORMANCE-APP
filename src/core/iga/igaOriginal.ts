/**
 * IGA (Índice Geral de Atividade) e ICV (Índice Cardiovascular Invictus)
 * VERSÃO ORIGINAL — fórmula literal do documento
 * "Invictus Performance — Metodologia Científica Oficial", Seção 10.5 e 10.6.
 *
 * ================================================================
 * ATENÇÃO — MOTOR DE TESTE INTERNO PARA APRESENTAÇÃO AOS SÓCIOS
 * ================================================================
 * Este arquivo reproduz a fórmula EXATAMENTE como publicada no documento
 * oficial, sem nenhum dos ajustes negociados posteriormente:
 *   - SEM Crel (calorias relativas ao peso corporal)
 *   - SEM gate gradual de antifraude de calorias
 *   - SEM handicap de idade
 *   - SEM acumulador de temporada / atualização diária
 *   - SEM gating de intensidade por movimento (giroscópio)
 *   - SEM peso diferenciado por tipo de atividade (treino vs. cardio)
 *
 * NÃO é utilizado pelo motor de pontuação em produção
 * (ver src/core/iga/igaEngine.ts, que é o motor real do app).
 * Existe apenas para demonstração/teste manual pelos sócios, isolado
 * do ranking e da pontuação de qualquer usuário real.
 *
 * O próprio documento oficial, na Seção 10.5 ("Nota metodológica para
 * revisão"), reconhece que somar F (sessões), C (kcal), T (minutos) e
 * I (%FCmax) numa mesma média geométrica mistura unidades incompatíveis,
 * tornando o resultado numérico dependente de escala. Essa limitação foi
 * mantida de propósito aqui, pois o pedido foi reproduzir o documento
 * exatamente como está — a versão corrigida é um entregável separado.
 */

export interface IGAOriginalSessionInput {
  id?: string;
  durationMinutes: number;
  caloriesInformed: number;
  avgHeartRate?: number;
  relativeIntensityPercent?: number;
  date?: string;
}

export interface IGAOriginalUserProfile {
  age?: number;
  maxHeartRate?: number;
}

export interface IGAOriginalWeekResult {
  F: number;
  C: number;
  T: number;
  I: number;
  iga: number;
  icv: number;
  sessionsConsidered: number;
  maxHeartRateUsed: number;
  auditSummary: string;
  calculatedAt: string;
}

function estimateMaxHeartRateOriginal(profile: IGAOriginalUserProfile = {}): number {
  if (profile.maxHeartRate && profile.maxHeartRate > 100) {
    return profile.maxHeartRate;
  }
  const age = Math.max(12, Number(profile.age) || 30);
  return Math.round(220 - age);
}

export function calculateWeeklyIGAOriginal(
  sessions: IGAOriginalSessionInput[],
  userProfile: IGAOriginalUserProfile = {}
): IGAOriginalWeekResult {
  const fcMax = estimateMaxHeartRateOriginal(userProfile);
  const valid = (sessions || []).filter(s => (Number(s.durationMinutes) || 0) > 0);

  const F = valid.length;
  const C = valid.reduce((acc, s) => acc + (Number(s.caloriesInformed) || 0), 0);
  const T = valid.reduce((acc, s) => acc + (Number(s.durationMinutes) || 0), 0);

  let weightedIntensitySum = 0;
  let weightedTime = 0;
  valid.forEach(s => {
    const duration = Number(s.durationMinutes) || 0;
    let pct = Number(s.relativeIntensityPercent);
    if (!Number.isFinite(pct) || pct <= 0) {
      const hr = Number(s.avgHeartRate) || 0;
      pct = hr > 0 && fcMax > 0 ? (hr / fcMax) * 100 : 0;
    }
    weightedIntensitySum += pct * duration;
    weightedTime += duration;
  });
  const I = weightedTime > 0 ? weightedIntensitySum / weightedTime : 0;

  const product = F * C * T * I;
  const iga = product > 0 ? Math.pow(product, 1 / 4) : 0;
  const icvProduct = I * T;
  const icv = icvProduct > 0 ? Math.sqrt(icvProduct) : 0;

  const auditSummary =
    `[IGA Original - Doc Oficial] F=${F} sessoes | C=${C} kcal | T=${T} min | ` +
    `I=${I.toFixed(1)}% FCmax | IGA=(F*C*T*I)^(1/4)=${iga.toFixed(2)} | ICV=raiz(I*T)=${icv.toFixed(2)}`;

  return {
    F,
    C,
    T,
    I: Math.round(I * 10) / 10,
    iga: Math.round(iga * 100) / 100,
    icv: Math.round(icv * 100) / 100,
    sessionsConsidered: F,
    maxHeartRateUsed: fcMax,
    auditSummary,
    calculatedAt: new Date().toISOString()
  };
}
