export interface ModalityConfig {
  id: string;
  label: string;
  category: 'outdoor' | 'indoor' | 'aquatic';
  requiresGps: boolean;
  hasRouteMap: boolean;
  hasDistance: boolean;
  hasPace: boolean;
  hasSpeed: boolean;
  requiresGymCheckin: boolean;
  maxSpeedKmH?: number;
  antiFraudProfile: 'RUNNING' | 'WALKING' | 'CYCLING' | 'INDOOR_CARDIO' | 'SWIMMING' | 'WORKOUT';
}

export const CARDIO_MODALITY_CONFIG: Record<string, ModalityConfig> = {
  running: {
    id: 'running',
    label: 'Corrida ao ar livre',
    category: 'outdoor',
    requiresGps: true,
    hasRouteMap: true,
    hasDistance: true,
    hasPace: true,
    hasSpeed: true,
    requiresGymCheckin: false,
    maxSpeedKmH: 30,
    antiFraudProfile: 'RUNNING'
  },
  walking: {
    id: 'walking',
    label: 'Caminhada ao ar livre',
    category: 'outdoor',
    requiresGps: true,
    hasRouteMap: true,
    hasDistance: true,
    hasPace: true,
    hasSpeed: true,
    requiresGymCheckin: false,
    maxSpeedKmH: 15,
    antiFraudProfile: 'WALKING'
  },
  bike: {
    id: 'bike',
    label: 'Bike ao ar livre',
    category: 'outdoor',
    requiresGps: true,
    hasRouteMap: true,
    hasDistance: true,
    hasPace: false,
    hasSpeed: true,
    requiresGymCheckin: false,
    maxSpeedKmH: 80,
    antiFraudProfile: 'CYCLING'
  },
  treadmill: {
    id: 'treadmill',
    label: 'Esteira',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    hasDistance: true,
    hasPace: true,
    hasSpeed: true,
    requiresGymCheckin: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  },
  stationary_bike: {
    id: 'stationary_bike',
    label: 'Bike ergométrica',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    hasDistance: true,
    hasPace: false,
    hasSpeed: true,
    requiresGymCheckin: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  },
  elliptical: {
    id: 'elliptical',
    label: 'Elíptico / Transport',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    hasDistance: false,
    hasPace: false,
    hasSpeed: false,
    requiresGymCheckin: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  },
  rowing: {
    id: 'rowing',
    label: 'Remo indoor',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    hasDistance: false,
    hasPace: false,
    hasSpeed: false,
    requiresGymCheckin: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  },
  stair_climber: {
    id: 'stair_climber',
    label: 'Escada / Stairmaster',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    hasDistance: false,
    hasPace: false,
    hasSpeed: false,
    requiresGymCheckin: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  },
  swimming: {
    id: 'swimming',
    label: 'Natação',
    category: 'aquatic',
    requiresGps: false,
    hasRouteMap: false,
    hasDistance: false,
    hasPace: false,
    hasSpeed: false,
    requiresGymCheckin: false,
    antiFraudProfile: 'SWIMMING'
  },
  hiit: {
    id: 'hiit',
    label: 'HIIT / Funcional',
    category: 'indoor',
    requiresGps: false,
    hasRouteMap: false,
    hasDistance: false,
    hasPace: false,
    hasSpeed: false,
    requiresGymCheckin: false,
    antiFraudProfile: 'INDOOR_CARDIO'
  }
};

export function getModalityConfig(cardioType?: string): ModalityConfig | null {
  if (!cardioType) return null;
  const key = cardioType.toLowerCase();
  return CARDIO_MODALITY_CONFIG[key] || null;
}
