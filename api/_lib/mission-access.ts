import { isCanonicalProEntitlement, isProUser } from './entitlement.js';

export type MissionAccessTier = 'free' | 'pro' | 'unknown';

export type MissionAccessSnapshot = {
  missionAccessTier: MissionAccessTier;
  missionAccessVersion: 1;
  missionAccessResolvedAt: string;
};

function timestampMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof (value as any)?.toMillis === 'function') return (value as any).toMillis();
  if (typeof (value as any)?._seconds === 'number') return (value as any)._seconds * 1000;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Congela o acesso no primeiro write da atividade. Rebuilds futuros nunca
 * consultam o plano atual, evitando conceder missões PRO retroativamente
 * depois de um upgrade ou retirar uma conquista depois de um downgrade.
 */
export function resolveMissionAccessSnapshot(
  profile: Record<string, any> | null | undefined,
  profileAvailable = true,
  resolvedAt = new Date(),
): MissionAccessSnapshot {
  if (!profileAvailable || !profile) {
    return {
      missionAccessTier: 'unknown',
      missionAccessVersion: 1,
      missionAccessResolvedAt: resolvedAt.toISOString(),
    };
  }
  const isPro = isProUser(profile, resolvedAt);
  return {
    missionAccessTier: isPro ? 'pro' : 'free',
    missionAccessVersion: 1,
    missionAccessResolvedAt: resolvedAt.toISOString(),
  };
}

export function preserveMissionAccessSnapshot(
  existing: Record<string, any> | null | undefined,
  fallback: MissionAccessSnapshot,
): MissionAccessSnapshot {
  const tier = existing?.missionAccessTier;
  if (tier !== 'free' && tier !== 'pro' && tier !== 'unknown') return fallback;
  // `unknown` representa falha/ausência de prova, não uma decisão eterna. Um
  // retry posterior pode completar o snapshot; free/pro já congelados nunca
  // são reavaliados por upgrade ou downgrade.
  if (tier === 'unknown' && fallback.missionAccessTier !== 'unknown') return fallback;
  return {
    missionAccessTier: tier,
    missionAccessVersion: 1,
    missionAccessResolvedAt: typeof existing?.missionAccessResolvedAt === 'string'
      ? existing.missionAccessResolvedAt : fallback.missionAccessResolvedAt,
  };
}

/**
 * Imports externos podem chegar semanas depois. Usa as datas autoritativas
 * do perfil para decidir o plano no instante da atividade; o plano atual só
 * serve como fallback para atividade recente. Sem prova histórica, congela
 * `unknown` (conta em missões Free, nunca em PRO).
 */
export function resolveExternalMissionAccessSnapshot(
  profile: Record<string, any> | null | undefined,
  profileAvailable: boolean,
  occurredAt: Date | string,
  resolvedAt = new Date(),
): MissionAccessSnapshot {
  if (!profileAvailable || !profile) return resolveMissionAccessSnapshot(null, false, resolvedAt);
  const occurrenceMs = timestampMs(occurredAt);
  if (occurrenceMs === null || occurrenceMs > resolvedAt.getTime() + 5 * 60_000) {
    return resolveMissionAccessSnapshot(null, false, resolvedAt);
  }

  const current = resolveMissionAccessSnapshot(profile, true, resolvedAt);
  const canonicalEntitlement = isCanonicalProEntitlement(profile.proEntitlement)
    ? profile.proEntitlement
    : null;
  const activationCandidates = [canonicalEntitlement?.purchasedAt]
    .map(timestampMs).filter((value): value is number => value !== null);
  const activatedAt = activationCandidates.length ? Math.min(...activationCandidates) : null;
  const canonicalStatus = String(canonicalEntitlement?.status || '').trim().toLowerCase();
  // Grace só estende o intervalo quando esse é realmente o estado canônico.
  // Refund/revoke não possuem neste schema um instante de término confiável;
  // nesses casos não inferimos retrospectivamente um período PRO.
  const canonicalPeriodEnd = canonicalStatus === 'grace_period' || canonicalStatus === 'grace'
    ? canonicalEntitlement?.gracePeriodExpiresAt ?? canonicalEntitlement?.expiresAt
    : canonicalStatus === 'active' || canonicalStatus === 'active_premium' || canonicalStatus === 'expired'
      ? canonicalEntitlement?.expiresAt
      : null;
  const expiresAt = timestampMs(canonicalPeriodEnd);

  if (activatedAt !== null && occurrenceMs < activatedAt) {
    return { ...current, missionAccessTier: 'free' };
  }
  if (activatedAt !== null && expiresAt !== null) {
    return {
      ...current,
      missionAccessTier: occurrenceMs <= expiresAt ? 'pro' : 'free',
    };
  }
  if (activatedAt !== null && current.missionAccessTier === 'pro') return current;
  // Um tier legado só pode indicar que faltam dados para um backfill; nunca é
  // prova suficiente para promover a atividade a PRO.
  const declaredTier = String(profile.subscriptionTier || profile.currentPlan || '').toLowerCase();
  if (current.missionAccessTier === 'free' && declaredTier !== 'performance' && declaredTier !== 'pro') return current;

  // Para webhook/sync próximo do treino, o plano atual é evidência suficiente;
  // para backfill antigo sem datas, falhamos fechado apenas para missões PRO.
  const isRecent = resolvedAt.getTime() - occurrenceMs <= 24 * 60 * 60_000;
  return isRecent ? current : { ...current, missionAccessTier: 'unknown' };
}
