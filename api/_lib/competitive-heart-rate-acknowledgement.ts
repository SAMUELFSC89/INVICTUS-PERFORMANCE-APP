import { createHash } from 'node:crypto';
import { db, FieldValue } from './common.js';
import {
  COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION,
  COMPETITIVE_HR_CONSENT_TYPE,
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  type CompetitiveHrAcknowledgementInput,
} from '../../shared/competitiveHeartRatePolicy.js';

const ALLOWED_PLATFORMS = new Set(['ios', 'android', 'web']);
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function isCurrentCompetitiveHrAcknowledgement(data: Record<string, any> | undefined, competitionId: string, competitionRulesVersion: string): boolean {
  return Boolean(data?.accepted === true
    && data?.consentType === COMPETITIVE_HR_CONSENT_TYPE
    && data?.competitionId === competitionId
    && data?.competitionRulesVersion === competitionRulesVersion
    && data?.hrAcknowledgementVersion === COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION);
}

export async function recordCompetitiveHrAcknowledgement(
  userId: string,
  expectedCompetitionId: string,
  expectedRulesVersion: string,
  raw: Partial<CompetitiveHrAcknowledgementInput> | undefined,
) {
  if (!db) throw new Error('Banco de dados indisponível.');
  if (!raw || raw.accepted !== true || raw.consentType !== COMPETITIVE_HR_CONSENT_TYPE) {
    throw new Error('É necessário aceitar de forma afirmativa a ciência sobre frequência cardíaca antes de participar.');
  }
  if (raw.competitionId !== expectedCompetitionId || raw.competitionRulesVersion !== expectedRulesVersion
    || raw.hrAcknowledgementVersion !== COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION
    || raw.privacyPolicyVersion !== PRIVACY_POLICY_VERSION || raw.termsVersion !== TERMS_VERSION) {
    throw new Error('O aviso ou as regras competitivas foram atualizados. Leia e aceite a versão vigente.');
  }
  const platform = clean(raw.platform, 16);
  const appVersion = clean(raw.appVersion, 40);
  const locale = clean(raw.locale, 24) || 'pt-BR';
  if (!ALLOWED_PLATFORMS.has(platform) || !appVersion) throw new Error('Metadados do aceite inválidos. Atualize o app e tente novamente.');

  const material = [userId, expectedCompetitionId, expectedRulesVersion, COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION].join('|');
  const acknowledgementId = createHash('sha256').update(material).digest('hex');
  const acknowledgementRef = db.collection('competitive_hr_acknowledgements').doc(acknowledgementId);
  const existing = await acknowledgementRef.get();
  const record = {
    acknowledgementId,
    userId,
    consentType: COMPETITIVE_HR_CONSENT_TYPE,
    competitionId: expectedCompetitionId,
    competitionRulesVersion: expectedRulesVersion,
    hrAcknowledgementVersion: COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    termsVersion: TERMS_VERSION,
    accepted: true,
    platform,
    appVersion,
    locale,
    updatedAt: FieldValue.serverTimestamp(),
    ...(!existing.exists ? { acceptedAt: FieldValue.serverTimestamp() } : {}),
  };
  await acknowledgementRef.set(record, { merge: true });
  return { acknowledgementId, ...record };
}
