export interface ModalityBackendConfig {
  id: string;
  label: string;
  category: 'outdoor' | 'indoor' | 'aquatic';
  requiresGps: boolean;
  hasRouteMap: boolean;
  requiresMotionEvidence: boolean;
  maxSpeedKmH?: number;
  antiFraudProfile: 'RUNNING' | 'WALKING' | 'CYCLING' | 'INDOOR_CARDIO' | 'SWIMMING' | 'WORKOUT';
}

export const MODALITY_BACKEND_CONFIG: Record<string, ModalityBackendConfig> = {
  running: {
    id: 'running',
    label: 'Corrida ao ar livre',
    category: 'outdoor',
    requiresGps: true,
    hasRouteMap: true,
    requiresMotionEvidence: true,
    maxSpeedKmH: 30,
    antiFraudProfile: 'RUNNING'
  },
  walking: {
    id: 'walking',
    label: 'Caminhada ao ar livre',
    category: 'outdoor',
    requiresGps: true,
    hasRouteMap: true,
    requiresMotionEvidence: true,
    maxSpeedKmH: 15,
    antiFraudProfile: 'WALKING'
  },
  bike: {
    id: 'bike',
    label: 'Bike ao ar livre',
    category: 'outdoor',
    requiresGps: true,
    hasRouteMap: true,
    requiresMotionEvidence: true,
    maxSpeedKmH: 80,
    antiFraudProfile: 'CYCLING'
  },
  treadmill: {
    id: 'treadmill',
    label: 'Esteira',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    requiresMotionEvidence: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  },
  stationary_bike: {
    id: 'stationary_bike',
    label: 'Bike ergométrica',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    requiresMotionEvidence: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  },
  elliptical: {
    id: 'elliptical',
    label: 'Elíptico / Transport',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    requiresMotionEvidence: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  },
  rowing: {
    id: 'rowing',
    label: 'Remo indoor',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    requiresMotionEvidence: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  },
  stair_climber: {
    id: 'stair_climber',
    label: 'Escada / Stairmaster',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    requiresMotionEvidence: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  },
  swimming: {
    id: 'swimming',
    label: 'Natação',
    category: 'aquatic',
    requiresGps: false,
    hasRouteMap: false,
    requiresMotionEvidence: false,
    antiFraudProfile: 'SWIMMING'
  },
  hiit: {
    id: 'hiit',
    label: 'HIIT / Funcional',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    requiresMotionEvidence: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  }
};

/**
 * #239: PERFIS DE VALIDACAO POR MODALIDADE.
 *
 * Ate agora o antifraude usava UM unico par de limites de duracao
 * (SECURITY_CONFIG.validation.minDurationMins/maxDurationMins = 5..360) para
 * tudo. Musculacao e cardio nao se provam da mesma forma: musculacao se prova
 * por presenca/duracao/esforco/coerencia (pace e distancia sao irrelevantes) e
 * cardio se prova por movimento/GPS/distancia/pace (onde ficar parado nao vale).
 *
 * Este e o unico lugar onde essa diferenca vive. Adicionar uma modalidade nova
 * no futuro e adicionar um perfil aqui -- nao espalhar `if (tipo === ...)` pelos
 * motores. Power Lift tem perfil proprio de proposito: ele NAO herda as regras
 * de musculacao comum, porque a prova dele e o video da execucao com a carga.
 *
 * Os limites de tempo (30-90 musculacao / 20-90 cardio) sao regra de produto
 * definida pelo usuario, nao um numero escolhido aqui.
 */
export type PerfilValidacaoId = 'STRENGTH' | 'CARDIO' | 'POWERLIFT';

export interface PerfilValidacao {
  id: PerfilValidacaoId;
  rotulo: string;
  /** Abaixo disso a sessao nao e COMPETITIVAMENTE elegivel (nao e fraude). */
  minMinutosCompetitivos: number;
  /** Teto do que conta para pontuacao, mesmo que a sessao tenha durado mais. */
  maxMinutosContabilizados: number;
  /** Acima disso a duracao deixa de ser plausivel e vira sinal de integridade. */
  maxMinutosPlausiveis: number;
  /** Se movimento/GPS/distancia/pace sao evidencia relevante nesta modalidade. */
  usaEvidenciaDeDeslocamento: boolean;
  /** Se a prova principal e um video da execucao. */
  exigeVideo: boolean;
}

export const PERFIS_VALIDACAO: Record<PerfilValidacaoId, PerfilValidacao> = {
  STRENGTH: {
    id: 'STRENGTH',
    rotulo: 'Musculação',
    minMinutosCompetitivos: 30,
    maxMinutosContabilizados: 90,
    maxMinutosPlausiveis: 240,
    usaEvidenciaDeDeslocamento: false,
    exigeVideo: false
  },
  CARDIO: {
    id: 'CARDIO',
    rotulo: 'Cardio',
    minMinutosCompetitivos: 20,
    maxMinutosContabilizados: 90,
    maxMinutosPlausiveis: 360,
    usaEvidenciaDeDeslocamento: true,
    exigeVideo: false
  },
  POWERLIFT: {
    id: 'POWERLIFT',
    rotulo: 'Power Lift',
    // Uma tentativa de levantamento dura segundos: tempo nao e criterio aqui.
    minMinutosCompetitivos: 0,
    maxMinutosContabilizados: 0,
    maxMinutosPlausiveis: 240,
    usaEvidenciaDeDeslocamento: false,
    exigeVideo: true
  }
};

/** Descobre o perfil de validacao a partir do payload da atividade. */
export function resolverPerfilValidacao(activity: any): PerfilValidacao {
  const bruto = (activity?.activityType || activity?.type || activity?.sportType || '').toString().toLowerCase();

  if (bruto.includes('power') || bruto.includes('lift') || bruto.includes('levantamento')) return PERFIS_VALIDACAO.POWERLIFT;

  // Uma modalidade de cardio ja mapeada acima e sempre cardio.
  const modalidade = resolveModality(activity);
  if (modalidade) return PERFIS_VALIDACAO.CARDIO;

  if (bruto.includes('cardio') || bruto.includes('run') || bruto.includes('corrida')
    || bruto.includes('walk') || bruto.includes('caminhada') || bruto.includes('bike')
    || bruto.includes('cycl') || bruto.includes('swim') || bruto.includes('natacao')) return PERFIS_VALIDACAO.CARDIO;

  // Musculacao/check-in de academia e o padrao: e o caso mais comum e o que
  // NAO depende de deslocamento para se provar.
  return PERFIS_VALIDACAO.STRENGTH;
}

export function resolveModality(activity: any): ModalityBackendConfig | null {
  const raw = (activity.cardioType || activity.activityType || activity.type || '').toString().toLowerCase();
  if (MODALITY_BACKEND_CONFIG[raw]) {
    return MODALITY_BACKEND_CONFIG[raw];
  }
  // Fallbacks de aliases comuns
  if (raw.includes('run') || raw.includes('corrida')) return MODALITY_BACKEND_CONFIG.running;
  if (raw.includes('walk') || raw.includes('caminhada')) return MODALITY_BACKEND_CONFIG.walking;
  if (raw.includes('bike') && !raw.includes('ergometrica') && !raw.includes('stationary')) return MODALITY_BACKEND_CONFIG.bike;
  if (raw.includes('cycling')) return MODALITY_BACKEND_CONFIG.bike;
  if (raw.includes('treadmill') || raw.includes('esteira')) return MODALITY_BACKEND_CONFIG.treadmill;
  if (raw.includes('hiit') || raw.includes('funcional')) return MODALITY_BACKEND_CONFIG.hiit;
  if (raw.includes('swim') || raw.includes('natacao')) return MODALITY_BACKEND_CONFIG.swimming;
  return null;
}
