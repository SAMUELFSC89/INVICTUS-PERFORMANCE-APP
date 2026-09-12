import type { ObjectiveAnswers, ProfileSnapshot } from './types.js';

/**
 * Evidence layer for the Cardio Objective engine.
 *
 * IMPORTANT:
 * - These references support principles (start gradually, individualize, keep most endurance work easy, monitor load).
 * - Exact minutes/fractions/ratio bands used by Invictus are product guardrails, not claims that a paper prescribed that exact number.
 * - This module is intentionally static/versioned: production decisions must not depend on live web content.
 */
export const CARDIO_RESEARCH_VERSION = 'CARDIO_EVIDENCE_2026_09_V2' as const;

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
    year: 2025,
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
    supports: 'Endurance athletes usually accumulate most volume at low intensity; evidence does not support blindly assigning one identical intensity-distribution model to every athlete.',
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
    year: 2022,
    title: 'The Association Between Running Injuries and Training Parameters: A Systematic Review',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34478518/',
    supports: 'Evidence linking injury onset to specific running distance, duration, frequency, intensity or recent changes is conflicting; caution is warranted when recommending universal progression parameters.',
  },
  LOAD_PROGRESSION_2021: {
    kind: 'sports_medicine_editorial',
    year: 2021,
    title: 'When progressing training loads, what are the considerations for healthy and injured athletes?',
    url: 'https://bjsm.bmj.com/content/55/17/947',
    supports: 'Training load should be interpreted against current sport-specific capacity and progressed in an individualized way rather than detached from what the athlete is currently tolerating.',
  },
  ACWR_2025: {
    kind: 'systematic_review_meta_analysis',
    year: 2025,
    title: 'Acute to chronic workload ratio for predicting sports injury risk: a systematic review and meta-analysis',
    url: 'https://pubmed.ncbi.nlm.nih.gov/41029871/',
    supports: 'Workload ratios may describe recent-versus-prior load context, but heterogeneity, calculation differences and publication bias require caution; a ratio should not be treated as a universal injury-risk threshold.',
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
    return ['WHO_2020', 'CDC_START_SLOW', 'ACSM_FITT', 'LOAD_PROGRESSION_2021'];
  }
  if (profileClass === 'active') return ['WHO_2020', 'ACSM_FITT', 'LOAD_PROGRESSION_2021', 'RUNNING_LOAD_2021', 'ACWR_2025'];
  return ['ACSM_FITT', 'SEILER_2010', 'ENDURANCE_TID_2025', 'ELITE_TID_2023', 'LOAD_PROGRESSION_2021', 'RUNNING_LOAD_2021', 'ACWR_2025'];
}

/**
 * Questions the deterministic engine must answer before setting the mission.
 * They are persisted as a decision trace so we can audit why two people with
 * different training backgrounds received different challenges.
 */
export function buildResearchDecisionTrace(
  answers: ObjectiveAnswers,
  profile: ProfileSnapshot | undefined,
  profileClass: ResearchProfileClass,
): ResearchDecisionAnswer[] {
  const history = profile?.cardioHistory;
  const signature = history?.capacitySignature;
  const recentSessions = history?.sessions28d ?? profile?.recentCardioSessions;
  const longestRun = signature?.longestRunningDistanceKm28d ?? profile?.recentLongestRunKm;
  const structuredRunner = answers.runningAbility === 'structured';
  const trainedBackground = ['regular', 'structured', 'competitive'].includes(answers.trainingBackground || '');
  const trained = answers.runningAbility === 'regular' || structuredRunner || trainedBackground || profileClass === 'advanced';
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
      question: 'A pessoa está sedentária, começando, ativa, treinada ou em nível competitivo?',
      answer: `${profileClass}; contexto=${answers.trainingBackground || 'legado/não informado'}; esporte=${answers.primarySport || 'não informado'}; histórico=${hasHistory ? 'disponível' : 'indisponível'}; sessões28d=${recentSessions ?? 'n/d'}`,
      impact: profileClass === 'sedentary' ? 'começar com carga útil, fácil e gradual' : 'evitar missão trivial incompatível com o nível atual',
      evidenceIds: profileClass === 'sedentary' || profileClass === 'beginner' ? ['WHO_2020', 'CDC_START_SLOW'] : ['ACSM_FITT'],
    },
    {
      id: 'observed_training_history',
      question: 'O que a pessoa realmente fez nos últimos 7 e 28 dias?',
      answer: history
        ? `7d=${history.sessions7d} sessão(ões)/${history.minutes7d}min/${history.activeDays7d} dia(s); 28d=${history.sessions28d} sessão(ões)/${history.minutes28d}min/${history.activeDays28d} dia(s); média=${history.averageSessionMinutes28d ?? 'n/d'}min; mediana=${signature?.medianSessionMinutes28d ?? 'n/d'}min; maior=${history.longestSessionMinutes28d ?? 'n/d'}min`
        : 'histórico canônico detalhado indisponível',
      impact: history && history.sessions28d > 0
        ? 'ancorar a missão em capacidade observada e evitar depender apenas da identidade declarada no questionário'
        : 'usar autorrelato de forma conservadora até existir histórico suficiente',
      evidenceIds: ['ACSM_FITT', 'LOAD_PROGRESSION_2021'],
    },
    {
      id: 'capacity_signature',
      question: 'Qual assinatura de capacidade aparece em frequência, consistência, modalidade e distância?',
      answer: signature
        ? `consistência=${signature.consistencyBand}; sessões/semana=${signature.sessionsPerWeek28d}; semanas ativas=${signature.activeWeeks28d}/4; modalidade dominante=${signature.dominantModality ?? 'n/d'}; distância28d=${signature.totalDistanceKm28d ?? 'n/d'}km; corrida28d=${signature.runningDistanceKm28d ?? 'n/d'}km; maior corrida=${signature.longestRunningDistanceKm28d ?? 'n/d'}km`
        : 'assinatura insuficiente',
      impact: signature && signature.consistencyBand !== 'insufficient'
        ? 'diferenciar pessoas com o mesmo rótulo de perfil usando o padrão real de frequência, modalidade, duração e distância'
        : 'não fabricar precisão quando há poucas atividades observadas',
      evidenceIds: ['ACSM_FITT', 'LOAD_PROGRESSION_2021'],
    },
    {
      id: 'recent_load_change',
      question: 'A carga dos últimos 7 dias mudou muito em relação aos 7 dias anteriores?',
      answer: history ? `tendência=${history.loadTrend}; razão descritiva=${history.loadRatio7d ?? 'insuficiente'}; 7d=${history.minutes7d}min; 7d anteriores=${history.previous7dMinutes}min` : 'dados insuficientes',
      impact: history && ['rising', 'spiking'].includes(history.loadTrend)
        ? 'não acrescentar automaticamente mais carga no início; usar a tendência somente como contexto, nunca como diagnóstico ou escore de risco'
        : 'não há sinal contextual suficiente para limitar a missão por mudança recente de volume',
      evidenceIds: ['LOAD_PROGRESSION_2021', 'ACWR_2025', 'RUNNING_LOAD_2021'],
    },
    {
      id: 'sport_transfer',
      question: 'A pessoa já pratica outro esporte com exigência cardiovascular relevante?',
      answer: `esporte=${answers.primarySport || 'não informado'}; rotina=${answers.trainingBackground || 'não informada'}; modalidade observada=${signature?.dominantModality ?? 'n/d'}`,
      impact: answers.primarySport && answers.primarySport !== 'none' && trainedBackground
        ? 'não confundir falta de experiência em corrida com sedentarismo geral; transferir capacidade cardiovascular com cautela para a modalidade escolhida'
        : 'usar capacidade específica declarada como referência principal',
      evidenceIds: ['ACSM_FITT'],
    },
    {
      id: 'continuous_capacity',
      question: 'Qual capacidade contínua já foi declarada ou observada?',
      answer: `caminhada=${answers.walkingMinutes}min; corrida=${answers.runningAbility}; sessão típica=${answers.typicalCardioMinutes ?? 'n/d'}min; mediana observada=${signature?.medianSessionMinutes28d ?? 'n/d'}min; maior corrida recente=${longestRun ?? 'n/d'}km`,
      impact: trained ? 'usar uma fração significativa da capacidade sem ultrapassar o tempo real disponível' : 'não exceder a capacidade declarada/observada e progredir gradualmente',
      evidenceIds: ['ACSM_FITT', 'WHO_2020', 'LOAD_PROGRESSION_2021'],
    },
    {
      id: 'goal_specificity',
      question: 'O objetivo pede corrida, saúde geral, consistência, performance ou retorno?',
      answer: answers.goalType,
      impact: runningGoal(answers.goalType) ? 'priorizar modalidade e métrica específicas de corrida quando coerentes com a capacidade' : 'priorizar aderência, modalidade preferida e contexto esportivo',
      evidenceIds: ['ACSM_FITT'],
    },
    {
      id: 'real_life_constraint',
      question: 'Quanto tempo e quantos dias realmente cabem na rotina?',
      answer: `${answers.availableMinutes}min disponíveis; ${answers.availableDays.length} dia(s) possíveis; sessão habitual=${answers.typicalCardioMinutes ?? 'n/d'}min`,
      impact: 'o plano deve caber na rotina; disponibilidade é teto de agenda e não deve apagar a capacidade atlética conhecida',
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
      id: 'recovery_information',
      question: 'Há informação suficiente para dizer que a pessoa está recuperada para receber intensidade maior?',
      answer: `histórico de atividade=${history ? 'sim' : 'não'}; recuperação fisiológica específica=não comprovada pelo onboarding`,
      impact: 'não inferir recuperação fisiológica a partir de silêncio, intervalo entre treinos ou razão de carga; usar energia/dificuldade/sinais no check-in semanal antes de progredir',
      evidenceIds: ['ACSM_FITT', 'LOAD_PROGRESSION_2021'],
    },
    {
      id: 'trained_intensity_distribution',
      question: 'Se a pessoa já é treinada, o desafio deve aumentar intensidade automaticamente?',
      answer: trained ? 'não automaticamente' : 'não aplicável nesta fase',
      impact: trained
        ? 'preservar predominância de esforço fácil; intensidade alta exige contexto de carga, recuperação e fase de treino que o onboarding ainda não comprova'
        : 'manter intensidade fácil enquanto a base é construída',
      evidenceIds: trained ? ['SEILER_2010', 'ENDURANCE_TID_2025', 'ELITE_TID_2023'] : ['WHO_2020'],
    },
    {
      id: 'progression_uncertainty',
      question: 'Existe uma porcentagem universal comprovada para aumentar carga com segurança?',
      answer: 'não',
      impact: 'usar passos pequenos, resposta semanal e limites individualizados; não codificar a regra de 10% ou uma faixa de ACWR como lei científica universal',
      evidenceIds: ['RUNNING_LOAD_2021', 'ACWR_2025'],
    },
  ];
}
