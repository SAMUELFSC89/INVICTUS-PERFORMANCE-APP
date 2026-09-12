import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Buscar Objetivo automatic cardio completion', () => {
  test('future mission unlocked internally is hidden until its scheduled date', () => {
    const service = read('src/services/cardioObjectiveService.ts');
    expect(service).toContain('normalizeObjectiveDailyAvailability');
    expect(service).toContain("mission.state === 'available' && mission.localDate > today");
    expect(service).toContain("state: 'locked' as const");
    expect(service).toContain('return normalizeObjectiveDailyAvailability(result)');
  });

  test('canonical cardio reconciliation does not depend on the route that started the session', () => {
    const sync = read('api/_lib/cardio-objective-activity-sync.ts');
    const stats = read('api/_lib/user-activity-stats.ts');
    expect(stats).toContain('await reconcileRecentCardioObjectives(userId)');
    expect(sync).toContain("data.type !== 'cardio'");
    expect(sync).toContain("recordStatus !== 'completed'");
    expect(sync).toContain("mission.localDate <= activityDate");
    expect(sync).toContain('missionMeetsActivity(journey, synthetic, activity)');
    expect(sync).toContain("account.collection('activity_claims').doc(activityId)");
    expect(sync).toContain("source: 'canonical_cardio_auto_sync'");
  });

  test('duplicate, blocked and ineligible cardios cannot complete a mission', () => {
    const sync = read('api/_lib/cardio-objective-activity-sync.ts');
    expect(sync).toContain("['duplicate', 'discarded', 'dedup_pending'].includes(quality)");
    expect(sync).toContain("reason === 'DUPLICATE_ACTIVITY'");
    expect(sync).toContain('data.securityBlocked === true');
    expect(sync).toContain('data.pendingReview === true');
    expect(sync).toContain('data.missionEligible === false');
  });

  test('completion notification is official server-side and deduplicated by activity', () => {
    const sync = read('api/_lib/cardio-objective-activity-sync.ts');
    const notificationHandler = read('api/_handlers/notifications.ts');
    expect(sync).toContain("account.collection('completion_notifications').doc(activityId)");
    expect(sync).toContain('notificationService.notify({');
    expect(sync).toContain("title: result.goalReached ? 'Objetivo alcançado! 🏆' : 'Missão concluída! ✅'");
    expect(sync).toContain("actionUrl: '/challenges/cardio/objective'");
    expect(notificationHandler).not.toContain('notificationService.notify({');
    expect(notificationHandler).toContain("return res.status(403).json({ error: 'Notificações são geradas apenas por fluxos oficiais do servidor.' })");
  });
});
