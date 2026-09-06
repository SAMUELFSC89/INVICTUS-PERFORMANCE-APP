import {
  preserveMissionAccessSnapshot,
  resolveExternalMissionAccessSnapshot,
  resolveMissionAccessSnapshot,
} from '../_lib/mission-access';

describe('mission access snapshot', () => {
  const receivedAt = new Date('2026-09-06T12:00:00.000Z');

  test('upgrade atual não transforma backfill anterior em progresso PRO', () => {
    const snapshot = resolveExternalMissionAccessSnapshot({
      subscriptionTier: 'performance',
      activatedAt: '2026-09-05T10:00:00.000Z',
      expiresAt: '2026-10-05T10:00:00.000Z',
    }, true, '2026-08-20T10:00:00.000Z', receivedAt);
    expect(snapshot.missionAccessTier).toBe('free');
  });

  test('atividade ocorrida dentro do intervalo autoritativo mantém acesso PRO após downgrade', () => {
    const snapshot = resolveExternalMissionAccessSnapshot({
      subscriptionTier: 'open',
      premium: false,
      activatedAt: '2026-08-01T10:00:00.000Z',
      expiresAt: '2026-09-01T10:00:00.000Z',
    }, true, '2026-08-20T10:00:00.000Z', receivedAt);
    expect(snapshot.missionAccessTier).toBe('pro');
  });

  test('backfill antigo sem prova de ativação falha fechado apenas para PRO', () => {
    const snapshot = resolveExternalMissionAccessSnapshot({
      subscriptionTier: 'performance', premium: true,
    }, true, '2026-08-20T10:00:00.000Z', receivedAt);
    expect(snapshot.missionAccessTier).toBe('unknown');
  });

  test('atividade recente pode usar o plano atual e timestamp futuro é desconhecido', () => {
    expect(resolveExternalMissionAccessSnapshot({
      subscriptionTier: 'performance', premium: true,
    }, true, '2026-09-06T10:00:00.000Z', receivedAt).missionAccessTier).toBe('pro');
    expect(resolveExternalMissionAccessSnapshot({
      subscriptionTier: 'performance', premium: true,
    }, true, '2026-09-07T10:00:00.000Z', receivedAt).missionAccessTier).toBe('unknown');
  });

  test('retry completa unknown, mas nunca recalcula free/pro já congelado', () => {
    const unknown = resolveMissionAccessSnapshot(null, false, receivedAt);
    const pro = resolveMissionAccessSnapshot({ subscriptionTier: 'performance' }, true, receivedAt);
    expect(preserveMissionAccessSnapshot(unknown, pro).missionAccessTier).toBe('pro');
    expect(preserveMissionAccessSnapshot({ ...unknown, missionAccessTier: 'free' }, pro).missionAccessTier).toBe('free');
  });
});
