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
