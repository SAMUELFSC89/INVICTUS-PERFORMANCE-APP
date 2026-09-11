import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const set = jest.fn();
const get = jest.fn(async () => ({ exists: false }));
const serverTimestamp = { __serverTimestamp: true };
jest.mock('../_lib/common', () => ({
  db: { collection: jest.fn(() => ({ doc: jest.fn(() => ({ get, set })) })) },
  FieldValue: { serverTimestamp: jest.fn(() => serverTimestamp) },
}));

import {
  isCurrentCompetitiveHrAcknowledgement,
  recordCompetitiveHrAcknowledgement,
} from '../_lib/competitive-heart-rate-acknowledgement';
import { buildCompetitionReviewAuditSnapshot } from '../_handlers/competition-review';
import {
  COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION,
  COMPETITIVE_HR_CONSENT_TYPE,
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  type CompetitiveHrAcknowledgementInput,
} from '../../shared/competitiveHeartRatePolicy';

const current: CompetitiveHrAcknowledgementInput = {
  accepted: true as const,
  consentType: COMPETITIVE_HR_CONSENT_TYPE,
  competitionId: 'gym_ranking',
  competitionRulesVersion: 'gym-ranking-v2-hr',
  hrAcknowledgementVersion: COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION,
  privacyPolicyVersion: PRIVACY_POLICY_VERSION,
  termsVersion: TERMS_VERSION,
  platform: 'ios' as const,
  appVersion: '1.2.3',
  locale: 'pt-BR',
};

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ exists: false });
});

test('registra prova mínima com identidade do servidor e timestamp servidor-autoritativo', async () => {
  const result = await recordCompetitiveHrAcknowledgement('user-a', 'gym_ranking', 'gym-ranking-v2-hr', current);
  expect(result.acknowledgementId).toMatch(/^[a-f0-9]{64}$/);
  expect(set).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user-a', consentType: COMPETITIVE_HR_CONSENT_TYPE, accepted: true,
    acceptedAt: serverTimestamp, platform: 'ios', appVersion: '1.2.3', locale: 'pt-BR',
  }), { merge: true });
});

test('reaceite idempotente preserva o primeiro carimbo de aceite', async () => {
  get.mockResolvedValue({ exists: true });
  await recordCompetitiveHrAcknowledgement('user-a', 'gym_ranking', 'gym-ranking-v2-hr', current);
  expect(set).toHaveBeenCalledWith(expect.not.objectContaining({ acceptedAt: expect.anything() }), { merge: true });
});

test('recusa ausência de ação afirmativa e qualquer versão material antiga', async () => {
  await expect(recordCompetitiveHrAcknowledgement('user-a', 'gym_ranking', 'gym-ranking-v2-hr', { ...current, accepted: false } as unknown as CompetitiveHrAcknowledgementInput))
    .rejects.toThrow(/aceitar de forma afirmativa/);
  await expect(recordCompetitiveHrAcknowledgement('user-a', 'gym_ranking', 'gym-ranking-v2-hr', { ...current, hrAcknowledgementVersion: 'old' } as unknown as CompetitiveHrAcknowledgementInput))
    .rejects.toThrow(/foram atualizados/);
  expect(set).not.toHaveBeenCalled();
});

test('validação da adesão exige escopo, regras e aviso vigentes', () => {
  expect(isCurrentCompetitiveHrAcknowledgement(current, 'gym_ranking', 'gym-ranking-v2-hr')).toBe(true);
  expect(isCurrentCompetitiveHrAcknowledgement(current, 'gym_ranking', 'new-rules')).toBe(false);
});

test('contrato mantém aceite separado, contestação autenticada e coleções sem escrita cliente', () => {
  const modal = readFileSync(resolve(process.cwd(), 'src/components/CompetitiveHeartRateAcknowledgement.tsx'), 'utf8');
  const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
  const review = readFileSync(resolve(process.cwd(), 'api/_handlers/competition-review.ts'), 'utf8');
  expect(modal).toContain('checked={accepted}');
  expect(modal).toContain('não concede, amplia nem substitui autorização');
  expect(review).toContain('verifyAuth(req)');
  expect(review).toContain('auditSnapshot');
  expect(rules).toMatch(/match \/competitive_hr_acknowledgements\/\{acknowledgementId\}[\s\S]*?allow write: if isAdmin\(\);/);
  expect(rules).toMatch(/match \/competition_review_requests\/\{requestId\}[\s\S]*?allow write: if isAdmin\(\);/);
});

test('contestação preserva os campos atuais da auditoria de frequência cardíaca', () => {
  expect(buildCompetitionReviewAuditSnapshot({ healthSession: { heartRate: { source: 'apple_health', samples: [{ bpm: 120 }], audit: {
    receivedSampleCount: 9,
    validSampleCount: 7,
    discardedSampleCount: 2,
    discardedReasons: { invalid_bpm: 2 },
    coveragePercent: 84,
    largestGapSeconds: 18,
    quality: 'partial',
    seriesHash: 'sha256:test',
  } } } })).toMatchObject({
    source: 'apple_health',
    receivedSamples: 9,
    acceptedSamples: 7,
    discardedSamples: 2,
    discardReasons: ['invalid_bpm: 2'],
    coverage: 84,
    largestGapSeconds: 18,
    quality: 'partial',
    integrityId: 'sha256:test',
  });
});
