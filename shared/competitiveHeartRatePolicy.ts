/** Fonte única e versionada para a ciência competitiva sobre frequência cardíaca. */
export const COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION = 'competitive-hr-v1';
export const COMPETITIVE_HR_CONSENT_TYPE = 'competitive_hr_measurement_acknowledgement' as const;
export const TERMS_VERSION = '5.0.0';
export const PRIVACY_POLICY_VERSION = '5.0.0';

export const COMPETITION_RULES_VERSIONS = {
  community_friends_v1: 'community-friends-v2-hr',
  gym_ranking: 'gym-ranking-v2-hr',
  invictus_strength_v1: 'invictus-strength-v1',
  invictus_cardio_v1: 'invictus-cardio-v1',
} as const;

export type CompetitiveHrScope = keyof typeof COMPETITION_RULES_VERSIONS | string;

export const COMPETITIVE_HR_TITLE = 'CIÊNCIA SOBRE FREQUÊNCIA CARDÍACA E PONTUAÇÃO COMPETITIVA';
export const COMPETITIVE_HR_MODAL_TITLE = 'Frequência cardíaca e competição';
export const COMPETITIVE_HR_SUMMARY = 'Relógios e sensores de frequência cardíaca possuem limitações de medição. Pequenas variações nos dados registrados podem influenciar métricas e pontuação.';
export const COMPETITIVE_HR_CHECKBOX = 'Li, compreendi e aceito as condições relativas às limitações da medição de frequência cardíaca e sua utilização na pontuação competitiva.';

export const COMPETITIVE_HR_FULL_TEXT = `Declaro estar ciente de que dados de frequência cardíaca obtidos por relógios, pulseiras, sensores, plataformas de saúde e demais dispositivos ou serviços conectados estão sujeitos a limitações técnicas, variações de medição, diferenças entre fabricantes, perda ou atraso de amostras e demais fatores inerentes à tecnologia utilizada.

Compreendo que tais dados podem ser utilizados pelo Invictus, conforme as Regras da Competição e os critérios publicados, para validação da atividade, determinação de intensidade, cálculo de métricas, pontuação, desempate e classificação.

Reconheço que a frequência cardíaca registrada pelo dispositivo ou recebida pela plataforma pode não corresponder de forma absolutamente exata à frequência cardíaca fisiológica real em todos os momentos e que variações legítimas de medição podem produzir diferenças nas métricas e na pontuação.

Fatores como movimento, intensidade, posição e contato do dispositivo com a pele, ajuste da pulseira, suor, características individuais, ambiente, qualidade e algoritmo do sensor, frequência de amostragem, bateria, conexão, sincronização, HealthKit, Health Connect, Strava, APIs e serviços de terceiros podem alterar a disponibilidade ou a leitura. Amostras podem chegar atrasadas, faltar ou ser descartadas de forma legítima pelos critérios publicados.

Declaro que fui informado dessa característica antes de participar e, estando de acordo com as Regras da Competição, opto voluntariamente por participar da modalidade competitiva utilizando os dados efetivamente recebidos, aceitos e validados pelo sistema. O algoritmo não acrescenta uma margem artificial: aplica as regras oficiais aos dados considerados válidos.

Este aceite não representa consentimento genérico para tratamento de dados de saúde, não substitui as permissões e bases legais descritas na Política de Privacidade e não representa renúncia a direitos. Posso apresentar contestação ou solicitar revisão quando houver indício de erro técnico, falha de processamento, inconsistência de dados ou aplicação incorreta das regras.`;

export interface CompetitiveHrAcknowledgementInput {
  accepted: true;
  consentType: typeof COMPETITIVE_HR_CONSENT_TYPE;
  competitionId: string;
  competitionRulesVersion: string;
  hrAcknowledgementVersion: typeof COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION;
  privacyPolicyVersion: typeof PRIVACY_POLICY_VERSION;
  termsVersion: typeof TERMS_VERSION;
  platform: 'ios' | 'android' | 'web';
  appVersion: string;
  locale: string;
}
