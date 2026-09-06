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

export type NormalizedActivityValidationStatus = 'recorded' | 'validated' | 'pending' | 'rejected' | 'not_eligible';

/**
 * A validação é um resultado competitivo legado. Métricas pessoais devem usar
 * `resolveActivityState(...).isCompleted`; ranking exige aprovação competitiva.
 */
export function normalizeActivityValidationStatus(value: unknown): NormalizedActivityValidationStatus | null {
  const status = String(value || '').trim().toLowerCase();
  if (['recorded', 'completed', 'registered', 'registrada', 'concluida', 'concluída', 'not_required', 'personal'].includes(status)) return 'recorded';
  if (['valid', 'validated', 'approved', 'homologated', 'homologada'].includes(status)) return 'validated';
  if (['pending', 'pending_review', 'manual_review', 'processing', 'suspicious', 'resolution_pending'].includes(status)) return 'pending';
  if (['invalid', 'rejected', 'refused', 'recusada'].includes(status)) return 'rejected';
  if (['not_eligible', 'ineligible'].includes(status)) return 'not_eligible';
  return null;
}

export function isValidatedActivityStatus(value: unknown): boolean {
  return normalizeActivityValidationStatus(value) === 'validated';
}

export type ActivityRecordStatus = 'active' | 'completed' | 'discarded' | 'unknown';
export type ActivityMode = 'personal' | 'competitive' | 'unresolved';
export type ActivityCompetitionStatus = 'not_applicable' | 'pending' | 'approved' | 'rejected' | 'ineligible' | 'resolution_pending' | 'unknown';

export interface ResolvedActivityState {
  recordStatus: ActivityRecordStatus;
  activityMode: ActivityMode;
  competitionStatus: ActivityCompetitionStatus;
  isCompleted: boolean;
  isCompetitionApproved: boolean;
  primaryLabel: string;
  competitionLabel?: string;
}

/**
 * Registro pessoal e resultado competitivo são eixos diferentes. Este helper
 * é a única regra de compatibilidade para documentos antigos, evitando que
 * cada tela transforme not_eligible em "atividade rejeitada".
 */
export function resolveActivityState(data: Record<string, any> | null | undefined): ResolvedActivityState {
  const value = data || {};
  const rawRecord = String(value.recordStatus || value.activityStatus || '').toLowerCase();
  const rawStatus = String(value.status || '').toLowerCase();
  const rawValidation = String(value.validationStatus ?? value.validation?.status ?? '').toLowerCase();
  const rawCompetition = String(value.competitionReviewStatus ?? value.competitionStatus ?? '').toLowerCase();
  const contexts = Array.isArray(value.competitionContexts) ? value.competitionContexts : [];
  const hasLegacyCompetitionSignal = contexts.length > 0
    || value.pendingReview === true
    || value.securityBlocked === true
    || value.securityReviewApplied === true
    || Number(value.competitionPoints) > 0
    || Number(value.rankingPointsEarned) > 0;

  const normalizedStatus = normalizeActivityValidationStatus(rawStatus);
  const normalizedValidation = normalizeActivityValidationStatus(rawValidation);
  let recordStatus: ActivityRecordStatus = 'unknown';
  // Um estado de registro explícito é autoritativo. Um `status: active`
  // legado não pode reabrir uma atividade que já foi marcada como concluída.
  if (['completed', 'recorded'].includes(rawRecord)) recordStatus = 'completed';
  else if (rawRecord === 'active') recordStatus = 'active';
  else if (['discarded', 'cancelled', 'abandoned'].includes(rawRecord)) recordStatus = 'discarded';
  else if (rawStatus === 'active') recordStatus = 'active';
  else if (['discarded', 'cancelled', 'abandoned'].includes(rawStatus)) recordStatus = 'discarded';
  else if (normalizedStatus || normalizedValidation) {
    const onlyUnscopedPending = (normalizedStatus === 'pending' || normalizedValidation === 'pending')
      && !hasLegacyCompetitionSignal
      && !rawCompetition;
    // Um `pending` antigo, sem registro concluído nem sinal de competição,
    // podia representar upload ainda incompleto. Não o promovemos a treino.
    if (!onlyUnscopedPending) recordStatus = 'completed';
  }

  const explicitActivityMode = value.activityMode === 'competitive'
    || value.activityMode === 'unresolved'
    || value.activityMode === 'personal';
  let activityMode: ActivityMode = value.activityMode === 'competitive'
    ? 'competitive'
    : value.activityMode === 'unresolved'
      ? 'unresolved'
      : value.activityMode === 'personal'
        ? 'personal'
        : hasLegacyCompetitionSignal || (rawCompetition && !['not_required', 'not_applicable'].includes(rawCompetition))
          ? 'competitive'
          : 'personal';

  let competitionStatus: ActivityCompetitionStatus = 'unknown';
  if (explicitActivityMode && activityMode === 'personal') competitionStatus = 'not_applicable';
  else if (['not_required', 'not_applicable'].includes(rawCompetition)) competitionStatus = 'not_applicable';
  else if (['approved', 'validated', 'valid'].includes(rawCompetition)) competitionStatus = 'approved';
  else if (['pending', 'pending_review', 'manual_review', 'processing'].includes(rawCompetition)) competitionStatus = 'pending';
  else if (['rejected', 'invalid', 'refused'].includes(rawCompetition)) competitionStatus = 'rejected';
  else if (['ineligible', 'not_eligible'].includes(rawCompetition)) competitionStatus = 'ineligible';
  else if (rawCompetition === 'resolution_pending') competitionStatus = 'resolution_pending';
  else if (activityMode === 'personal') competitionStatus = 'not_applicable';
  else if (['validated', 'valid', 'approved'].includes(rawValidation) || ['valid', 'validated'].includes(rawStatus)) competitionStatus = 'approved';
  else if (['pending', 'pending_review', 'manual_review', 'processing'].includes(rawValidation) || ['pending', 'pending_review'].includes(rawStatus)) competitionStatus = 'pending';
  else if (['rejected', 'invalid'].includes(rawValidation) || ['rejected', 'invalid'].includes(rawStatus)) competitionStatus = 'rejected';
  else if (['not_eligible', 'ineligible'].includes(rawValidation)) {
    const isLegacyCompetition = activityMode === 'competitive' || hasLegacyCompetitionSignal;
    competitionStatus = isLegacyCompetition ? 'ineligible' : 'not_applicable';
    if (!isLegacyCompetition) activityMode = 'personal';
  }

  const competitionLabel = competitionStatus === 'approved'
    ? 'PONTUAÇÃO COMPETITIVA VALIDADA'
    : competitionStatus === 'pending'
      ? 'PONTUAÇÃO EM ANÁLISE'
      : competitionStatus === 'rejected' || competitionStatus === 'ineligible'
        ? 'FORA DA PONTUAÇÃO'
        : competitionStatus === 'resolution_pending'
          ? 'PARTICIPAÇÃO SENDO CONCILIADA'
          : undefined;

  return {
    recordStatus,
    activityMode,
    competitionStatus,
    isCompleted: recordStatus === 'completed',
    isCompetitionApproved: competitionStatus === 'approved',
    primaryLabel: recordStatus === 'completed' ? 'ATIVIDADE CONCLUÍDA' : recordStatus === 'active' ? 'EM ANDAMENTO' : 'ATIVIDADE',
    competitionLabel,
  };
}

export function isCompletedActivityRecord(data: Record<string, any> | null | undefined): boolean {
  return resolveActivityState(data).isCompleted;
}

export function isCompetitionApproved(data: Record<string, any> | null | undefined): boolean {
  return resolveActivityState(data).isCompetitionApproved;
}
