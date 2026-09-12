import type { ObjectiveAnswers, ProfileSnapshot } from './types.js';

/**
 * Evidence layer for the Cardio Objective engine.
 *
 * IMPORTANT:
 * - These references support principles (start gradually, individualize, keep most endurance work easy, monitor load).
 * - Exact minutes/fractions used by Invictus are product guardrails, not claims that a paper prescribed that exact number.
 * - This module is intentionally static/versioned: production decisions must not depend on live web content.
 */
export const CARDIO_RESEARCH_VERSION = 'CARDIO_EVIDENCE_2026_09_V1' as const;

export const CARDIO_RESEARCH_SOURCES = {
  WHO_2020: {
    kind: 'guideline',
    year: 2020,
    title: 'WHO guidelines on physical activity and sedentary behaviour',
    url: 'https://www.who.int/publications/i/item/9789240015128',
    supports: 'Adults benefit from physical activity; inactive adults should start with small amounts and gradually increase frequency, intensity and duration. General adult target: 150–300 min/week moderate or equivalent.',
  },
  CDC_START_SLOW: {
    kind: 'public_health_guidance',
    year: 2026,
    title: 'CDC: Steps for Getting Started With Physical Activity',
    url: 'https://www.cdc.gov/healthy-weight-growth/physical-activity/getting-started.html',
    supports: 'Start slowly and work toward more time or more challenging activity while fitting activity into a realistic routine.',
  },
  ACSM_FITT: {
    kind: 'professional_guideline',
    year: 2024,
    title: 'ACSM exercise prescription principles (FITT-VP)',
    url: 'https://www.acsm.org/docs/default-source/publications-files/acsms-exercise-testing-prescription.pdf',
    supports: 'Exercise prescription should consider frequency, intensity, time, type, volume and progression and be matched to the person.',
  },
  SEILER_2010: {
    kind: 'review',
    year: 2010,
    title: 'Best practice for training intensity and duration distribution in endurance athletes',
    url: 'https://pubmed.ncbi.nlm.nih.gov/20861519/',
    supports: 'Well-trained endurance athletes typically accumulate a large majority of training at low intensity with a smaller amount of high-intensity work.',
  },
  ENDURANCE_TID_2025: {
    kind: 'systematic_review_meta_analysis',
    year: 2025,
    title: 'Training-intensity distribution interventions in endurance athletes',
    url: 'https://pubmed.ncbi.nlm.nih.gov/39888556/',
    supports: 'There is no single universally superior intensity-distribution model for every trained athlete; personalization and a predominance of low-intensity work remain important.',
  },
  ELITE_TID_2023: {
    kind: 'systematic_review',
    year: 2023,
    title: 'Training intensity distribution in elite-to-world-class endurance athletes',
    url: 'https://pubmed.ncbi.nlm.nih.gov/37964776/',
    supports: 'Elite endurance training distribution varies by sport and season phase; pyramidal and polarized patterns are both common.',
  },
  RUNNING_LOAD_2021: {
    kind: 'systematic_review',
    year: 2021,
    title: 'Association Between Running Injuries and Training Parameters',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34478518/',
    supports: 'Evidence does not justify a universal precise safe progression percentage; fixed rules such as a single weekly percentage should be treated cautiously.',
  },
} as const;

export type CardioEvidenceId = keyof typeof CARDIO_RESEARCH_SOURCES;
export type ResearchProfileClass = 'sedentary' | 'beginner' | 'active' | 'runner' | 'advanced' | 'returning';

export interface ResearchDecisionAnswer {
  id: string;
  question: string;
  answer: string;
  impact: string;
  evidenceIds: CardioEvidenceId[];
}

const runningGoal = (goal: ObjectiveAnswers['goalType']) => ['start_running', 'run_5k', 'run_10k', 'pace', 'race', 'weekly_distance', 'endurance'].includes(goal);

export function evidenceForProfile(profileClass: ResearchProfileClass): CardioEvidenceId[] {
  if (profileClass === 'sedentary' || profileClass === 'beginner' || profileClass === 'returning') {
    return ['WHO_2020', 'CDC_START_SLOW', 'ACSM_FITT'];
  }
  if (profileClass === 'active') return ['WHO_2020', 'ACSM_FITT', 'RUNNING_LOAD_2021'];
  return ['ACSM_FITT', 'SEILER_2010', 'ENDURANCE_TID_2025', 'ELITE_TID_2023', 'RUNNING_LOAD_2021'];
}

/**
 * Questions the deterministic engine must answer before setting the mission.
 * They are persisted/logged as a decision trace so we can later audit why two
 * users with different profiles received different challenges.
 */
export function buildResearchDecisionTrace(
  answers: ObjectiveAnswers,
  profile: ProfileSnapshot | undefined,
  profileClass: ResearchProfileClass,
): ResearchDecisionAnswer[] {
  const recentSessions = profile?.recentCardioSessions;
  const longestRun = profile?.recentLongestRunKm;
  const structured = answers.runningAbility === 'structured';
  const regularRunner = answers.runningAbility === 'regular' || structured;
  const hasHistory = profile?.historyStatus === 'available' || typeof recentSessions === 'number';

  return [
    {
      id: 'safety_gate',
      question: 'Existe algum sinal que exija bloquear ou tornar o retorno mais conservador?',
      answer: answers.safety.signals.length ? answers.safety.signals.join(',') : 'nenhum sinal informado',
      impact: answers.safety.signals.length ? 'segurança tem prioridade sobre performance' : 'seguir para classificação de capacidade',
      evidenceIds: ['ACSM_FITT'],
    },
    {
      id: 'current_activity',
      question: 'A pessoa está sedentária, começando, ativa ou já treina de forma consistente?',
      answer: `${profileClass}; histórico=${hasHistory ? 'disponível' : 'indisponível'}; sessões28d=${recentSessions ?? 'n/d'}`,
      impact: profileClass === 'sedentary' ? 'começar com carga útil, fácil e gradual' : 'evitar missão trivial incompatível com o nível',
      evidenceIds: profileClass === 'sedentary' || profileClass === 'beginner' ? ['WHO_2020', 'CDC_START_SLOW'] : ['ACSM_FITT'],
    },
    {
      id: 'continuous_capacity',
      question: 'Qual capacidade contínua já foi declarada ou observada?',
      answer: `caminhada=${answers.walkingMinutes}min; corrida=${answers.runningAbility}; maior corrida recente=${longestRun ?? 'n/d'}km`,
      impact: regularRunner ? 'preservar corrida e usar fração significativa da capacidade' : 'não exceder a capacidade declarada e progredir gradualmente',
      evidenceIds: ['ACSM_FITT', 'WHO_2020'],
    },
    {
      id: 'goal_specificity',
      question: 'O objetivo pede corrida, saúde geral, consistência ou retorno?',
      answer: answers.goalType,
      impact: runningGoal(answers.goalType) ? 'priorizar modalidade e métrica específicas de corrida quando coerentes com a capacidade' : 'priorizar aderência e modalidade preferida',
      evidenceIds: ['ACSM_FITT'],
    },
    {
      id: 'real_life_constraint',
      question: 'Quanto tempo e quantos dias realmente cabem na rotina?',
      answer: `${answers.availableMinutes}min; ${answers.availableDays.length} dia(s) possíveis`,
      impact: 'o plano deve caber na rotina; disponibilidade é teto, não prova de capacidade',
      evidenceIds: ['CDC_START_SLOW', 'ACSM_FITT'],
    },
    {
      id: 'adherence_barrier',
      question: 'Qual barreira mais ameaça a consistência?',
      answer: `${answers.barrier}; confiança=${answers.confidenceScore}/10`,
      impact: 'reduzir complexidade/carga dentro dos limites, sem transformar a missão em tarefa trivial',
      evidenceIds: ['CDC_START_SLOW'],
    },
    {
      id: 'trained_intensity_distribution',
      question: 'Se a pessoa já é treinada, o desafio deve aumentar intensidade automaticamente?',
      answer: regularRunner || profileClass === 'advanced' ? 'não automaticamente' : 'não aplicável nesta fase',
      impact: regularRunner || profileClass === 'advanced'
        ? 'preservar predominância de esforço fácil; intensidade alta exige contexto de carga e recuperação que este onboarding ainda não comprova'
        : 'manter intensidade fácil enquanto a base é construída',
      evidenceIds: regularRunner || profileClass === 'advanced' ? ['SEILER_2010', 'ENDURANCE_TID_2025', 'ELITE_TID_2023'] : ['WHO_2020'],
    },
    {
      id: 'progression_uncertainty',
      question: 'Existe uma porcentagem universal comprovada para aumentar carga com segurança?',
      answer: 'não',
      impact: 'usar passos pequenos, resposta semanal e limites individualizados; não codificar uma regra universal de 10%',
      evidenceIds: ['RUNNING_LOAD_2021'],
    },
  ];
}
