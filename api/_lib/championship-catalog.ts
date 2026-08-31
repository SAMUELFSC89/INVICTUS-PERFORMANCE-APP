import { Championship } from '../../src/types/championships.js';

/**
 * Campeonatos pagos permanecem fechados até a aprovação de uma edição real.
 * As prévias públicas de musculação e cardio são informativas e não entram
 * neste catálogo servidor-autoritativo, pois não podem aceitar inscrição,
 * aceite de regulamento ou cobrança.
 */
export const CHAMPIONSHIPS: Championship[] = [];

export function listChampionships(): Championship[] {
  return CHAMPIONSHIPS;
}

export function getChampionship(id: string): Championship | undefined {
  return CHAMPIONSHIPS.find(championship => championship.id === id);
}

export function isRegistrationOpen(_championship: Championship, _now: Date = new Date()): boolean {
  return false;
}

/** Nenhuma atividade é submetida a campeonato pago enquanto o catálogo estiver fechado. */
export function matchActiveChampionshipsForActivity(_params: {
  activityType: string;
  isIndoorCardio?: boolean;
  when: Date;
}): Championship[] {
  return [];
}
