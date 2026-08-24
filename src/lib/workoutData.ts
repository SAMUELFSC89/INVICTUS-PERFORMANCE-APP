/**
 * Normalização defensiva dos dados de atividade recebidos do Firestore.
 *
 * Nunca use a data atual como substituta para um timestamp inválido: isso
 * distorce relatórios de saúde e pode fazer uma atividade antiga aparecer no
 * período atual.
 */
export function readActivityTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Epoch em segundos (Firestore/algumas integrações) ou milissegundos.
    return value < 100_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === 'object') {
    const candidate = value as { toMillis?: () => number; seconds?: unknown; nanoseconds?: unknown };
    if (typeof candidate.toMillis === 'function') {
      const millis = candidate.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }
    if (typeof candidate.seconds === 'number' && Number.isFinite(candidate.seconds)) {
      const nanos = typeof candidate.nanoseconds === 'number' && Number.isFinite(candidate.nanoseconds)
        ? candidate.nanoseconds / 1_000_000
        : 0;
      return candidate.seconds * 1000 + nanos;
    }
  }

  return null;
}

export type NormalizedActivityValidationStatus = 'validated' | 'pending' | 'rejected' | 'not_eligible';

/**
 * Somente "validated" representa uma atividade já homologada. Estados ausentes
 * ou desconhecidos não podem entrar em métricas, ranking ou conquistas.
 */
export function normalizeActivityValidationStatus(value: unknown): NormalizedActivityValidationStatus | null {
  const status = String(value || '').trim().toLowerCase();
  if (['valid', 'validated', 'approved', 'homologated', 'homologada'].includes(status)) return 'validated';
  if (['pending', 'pending_review', 'manual_review', 'processing', 'suspicious'].includes(status)) return 'pending';
  if (['invalid', 'rejected', 'refused', 'recusada'].includes(status)) return 'rejected';
  if (['not_eligible', 'ineligible'].includes(status)) return 'not_eligible';
  return null;
}

export function isValidatedActivityStatus(value: unknown): boolean {
  return normalizeActivityValidationStatus(value) === 'validated';
}
