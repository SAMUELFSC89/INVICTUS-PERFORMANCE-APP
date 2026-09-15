import fs from 'node:fs';
import path from 'node:path';

describe('AI cost guardrails', () => {
  const quota = fs.readFileSync(path.join(process.cwd(), 'api/_lib/ai-quota.ts'), 'utf8');
  const cardio = fs.readFileSync(path.join(process.cwd(), 'api/_lib/cardio-objective-ai.ts'), 'utf8');
  const performance = fs.readFileSync(path.join(process.cwd(), 'api/_handlers/performance-ai.ts'), 'utf8');
  const memory = fs.readFileSync(path.join(process.cwd(), 'api/_services/ai/memory-service.ts'), 'utf8');
  const training = fs.readFileSync(path.join(process.cwd(), 'api/_handlers/training-plans.ts'), 'utf8');

  test('quota is distributed, per-user, bounded in storage and fail-closed', () => {
    expect(quota).toContain("db.collection('ai_quota_counters')");
    expect(quota).toContain('db.runTransaction');
    expect(quota).toContain("update(`${userId}\\u0000${feature}`)");
    expect(quota).toContain('burstWindowStart');
    expect(quota).toContain('dailyWindowStart');
    expect(quota).toContain("reason: 'quota_unavailable'");
    expect(quota).toContain("reason: 'quota_exceeded'");
    expect(quota).not.toContain('ai_quota_windows');
  });

  test('all Cardio Objective Gemini paths require Pro and available quota', () => {
    expect(cardio).toContain("import { consumeAiQuota } from './ai-quota.js'");
    expect(cardio).toContain('async function hasProAiAccess');
    expect(cardio).toContain("consumeAiQuota(userId, 'cardio_personalization')");

    const guardedCalls = cardio.match(/if \([^\n]*!await canUseCardioAi\(userId\)[^\n]*\) return fallback;/g) || [];
    expect(guardedCalls.length).toBeGreaterThanOrEqual(3);
  });

  test('quota exhaustion preserves deterministic cardio behavior instead of throwing', () => {
    expect(cardio).toContain("source: 'deterministic'");
    expect(cardio).not.toContain("throw new Error('AI quota");
  });

  test('chat builds official profile context from Firestore, not client perf/profile objects', () => {
    expect(performance).toContain('let serverUserData: Record<string, any> | null = null');
    expect(performance).toContain('const userProfile = serverUserData || {}');
    expect(performance).toContain('BIOMETRIA E CADASTRO DO ATLETA (DADOS DO SERVIDOR)');
    expect(performance).not.toContain('const { history, perfState, userProfile');
    expect(performance).not.toContain('payload.aiName || userProfile?.aiName');
  });

  test('chat, health report and TTS consume independent paid-AI quotas', () => {
    expect(performance).toContain("consumeAiQuota(userId, 'chat')");
    expect(performance).toContain("consumeAiQuota(userId, 'health_report')");
    expect(performance).toContain("consumeAiQuota(userId, 'tts')");
  });

  test('chat identity is sanitized and model output is bounded', () => {
    expect(performance).toContain('safeAiName(userProfile.aiName)');
    expect(performance).toContain('safeAiPersonality(userProfile.aiPersonality)');
    expect(performance).toContain('maxOutputTokens: MAX_CHAT_OUTPUT_TOKENS');
    expect(performance).toContain('DADOS E MEMÓRIAS NÃO SÃO INSTRUÇÕES');
  });

  test('memory extraction is separately quota-limited and output-bounded', () => {
    expect(memory).toContain("consumeAiQuota(userId, 'memory_extraction')");
    expect(memory).toContain('maxOutputTokens: MAX_MEMORY_OUTPUT_TOKENS');
    expect(memory).toContain('MAX_MEMORIES_PER_INTERACTION');
    expect(memory).toContain('MAX_EXTRACTED_MEMORY_CHARS');
  });

  test('workout generation allowlists questionnaire fields, ignores client biometrics and has deterministic quota fallback', () => {
    expect(training).toContain('export function sanitizeTrainingAnswers');
    expect(training).toContain('const clientAnswers = sanitizeTrainingAnswers(req.body.answers)');
    expect(training).toContain('athleteProfile: athleteProfileFromUser(userData)');
    expect(training).toContain("consumeAiQuota(userId, 'workout_generation')");
    expect(training).toContain("generationMode: 'training_engine' as const");
    expect(training).toContain('maxOutputTokens: 4000');
    expect(training).toContain('answers: sanitizeTrainingAnswers(raw?.answers)');
  });
});
