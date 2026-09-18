import { db } from './common.js';
import { notificationService, type NotificationPayload } from '../_services/notification-service.js';
import { localDate } from '../../src/core/cardioObjective/engine.js';

/**
 * Base reaproveitável para notificações de engajamento (push + in-app),
 * distintas das notificações transacionais (saque, missão concluída, etc.)
 * que já existem em NotificationService. Uma "regra de engajamento" decide,
 * a partir de um lote de usuários com push ativo, para quem enviar hoje.
 *
 * Fluxo: cron autenticado -> runEngagementRule(regra) -> a regra recebe os
 * candidatos (uids com token de push registrado) e devolve quem deve
 * receber a notificação hoje -> o motor garante idempotência (no máximo um
 * envio por usuário+regra+dia) antes de chamar NotificationService.
 */

// Brasil não tem mais horário de verão desde 2019 -- fuso fixo UTC-3, mesma
// premissa já usada em outros pontos do backend (ex.: janela de SMS).
const BR_TIMEZONE = 'America/Sao_Paulo';
const BR_UTC_OFFSET_HOURS = 3;
const DEFAULT_MAX_CANDIDATES_PER_RUN = 500;

export interface EngagementRuleContext {
  /** Dia local de Brasília no formato YYYY-MM-DD. */
  todayStr: string;
  /** Início do dia local de Brasília, em UTC. */
  dayStartUTC: Date;
  /** Início do dia seguinte (exclusivo), em UTC. */
  dayEndUTC: Date;
}

export interface EngagementRuleResult {
  userId: string;
  notification: NotificationPayload;
}

export interface EngagementRule {
  /** Identificador estável -- usado na chave de idempotência diária. */
  id: string;
  buildCandidates(
    ctx: EngagementRuleContext,
    candidateUserIds: string[],
  ): Promise<EngagementRuleResult[]>;
}

export interface EngagementRunSummary {
  ruleId: string;
  candidates: number;
  sent: number;
  skippedAlreadySent: number;
  failed: number;
}

export function brDayBoundsUTC(now: Date): EngagementRuleContext {
  const todayStr = localDate(now.toISOString(), BR_TIMEZONE);
  const dayStartUTC = new Date(`${todayStr}T${String(BR_UTC_OFFSET_HOURS).padStart(2, '0')}:00:00.000Z`);
  const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);
  return { todayStr, dayStartUTC, dayEndUTC };
}

/**
 * Quantos dias (calendário de Brasília) separam uma data passada de "hoje"
 * (o dia de `ctx`). Usado pelas regras de onboarding em drip (dia 1, 3, 7
 * após o cadastro) em vez de repetir a mesma notificação todo dia -- mesmo
 * padrão usado por apps de hábito (Duolingo, Strava) para não cansar quem
 * ainda está conhecendo o produto. Retorna null se a data for inválida.
 */
export function brDaysSince(pastValue: unknown, ctx: EngagementRuleContext): number | null {
  const pastMs = Date.parse(String(pastValue || ''));
  if (!Number.isFinite(pastMs)) return null;
  const pastDayStr = localDate(new Date(pastMs).toISOString(), BR_TIMEZONE);
  const pastDayStartUTC = new Date(`${pastDayStr}T${String(BR_UTC_OFFSET_HOURS).padStart(2, '0')}:00:00.000Z`).getTime();
  return Math.round((ctx.dayStartUTC.getTime() - pastDayStartUTC) / 86_400_000);
}

/**
 * Usuários com pelo menos um token de push ativo, a partir do registro
 * push_device_tokens (muito menor que a coleção inteira de usuários, já que
 * só existe um doc por token realmente registrado e válido).
 */
async function activePushCandidateUserIds(limit: number): Promise<string[]> {
  const snapshot = await db.collection('push_device_tokens').limit(limit).get();
  const uids = new Set<string>();
  snapshot.docs.forEach((docSnap: any) => {
    const ownerUid = String(docSnap.data()?.ownerUid || '');
    if (ownerUid) uids.add(ownerUid);
  });
  return [...uids];
}

/**
 * Reserva atômica de "já notifiquei este usuário com esta regra hoje".
 * Usa o mesmo padrão de criação idempotente (create() falha se o doc já
 * existe) já usado em ActivityRepository.createIfAbsent().
 */
async function reserveDailySend(userId: string, ruleId: string, todayStr: string): Promise<boolean> {
  const ref = db.collection('engagement_notification_log').doc(`${userId}_${ruleId}_${todayStr}`);
  try {
    await ref.create({
      userId,
      ruleId,
      date: todayStr,
      createdAt: new Date().toISOString(),
    });
    return true;
  } catch {
    // Já reservado (envio anterior no mesmo dia ou corrida concorrente) --
    // comportamento esperado, não é erro.
    return false;
  }
}

export async function runEngagementRule(
  rule: EngagementRule,
  now: Date = new Date(),
  maxCandidatesPerRun: number = DEFAULT_MAX_CANDIDATES_PER_RUN,
): Promise<EngagementRunSummary> {
  const ctx = brDayBoundsUTC(now);
  const candidateUserIds = await activePushCandidateUserIds(maxCandidatesPerRun);

  const summary: EngagementRunSummary = {
    ruleId: rule.id,
    candidates: candidateUserIds.length,
    sent: 0,
    skippedAlreadySent: 0,
    failed: 0,
  };

  if (candidateUserIds.length === 0) return summary;

  const results = await rule.buildCandidates(ctx, candidateUserIds);

  for (const result of results) {
    const reserved = await reserveDailySend(result.userId, rule.id, ctx.todayStr);
    if (!reserved) {
      summary.skippedAlreadySent += 1;
      continue;
    }
    try {
      await notificationService.notify(result.notification);
      summary.sent += 1;
    } catch (error: any) {
      summary.failed += 1;
      console.error(`[EngagementNotifications] Falha ao enviar '${rule.id}' para ${result.userId}: ${error?.message || error}`);
    }
  }

  return summary;
}
