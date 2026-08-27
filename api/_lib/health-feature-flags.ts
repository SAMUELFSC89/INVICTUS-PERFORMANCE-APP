/**
 * FEATURE FLAGS -- INVICTUS HEALTH (Fase 1).
 *
 * Modela as tres camadas do produto que o usuario descreveu:
 *   Invictus -> Invictus Pro -> (futuro) Invictus Health Professional.
 *
 * `true` aqui significa "a fundacao de dados e leitura ja existe e pode ser
 * ligada com seguranca". NAO significa "ja tem tela pronta" -- Fase 1 e so a
 * camada de dados (api/_lib/health-data-layer.ts) + este arquivo de flags,
 * sem UI nova.
 *
 * `false` marca tudo que depende do compartilhamento profissional
 * (medico/clinica/hospital): essa parte exige uma etapa propria de
 * compliance/interoperabilidade (LGPD, e HL7 FHIR quando fizer sentido) que
 * ainda nao foi feita -- ligar a flag antes disso seria fingir que a parte
 * clinica do produto ja existe, o que o usuario foi explicito em NAO querer.
 *
 * Alterar um valor aqui e a UNICA acao necessaria para ligar/desligar uma
 * camada -- nenhum outro arquivo deve duplicar essa decisao.
 */
export const HEALTH_FEATURE_FLAGS = {
  // Camada 1/2 -- Invictus / Invictus Pro. Dados longitudinais do proprio
  // usuario, nunca compartilhados com terceiros.
  healthReports: true,
  healthBaseline: true,
  healthInsights: true,

  // Camada 3 -- Invictus Health Professional (futuro, desativado).
  professionalSharing: false,
  professionalDashboard: false,
  clinicalIntegrations: false,
  hospitalPortal: false
} as const;

export type HealthFeatureFlag = keyof typeof HEALTH_FEATURE_FLAGS;
