export interface ReputationFactor {
  code: string;
  impact: number; // positive or negative score delta
  description: string;
}

export interface ReputationResult {
  reputationScore: number; // 0 - 100
  reputationTier: 'ELITE' | 'TRUSTED' | 'STANDARD' | 'SUSPECT' | 'BANNED';
  factors: ReputationFactor[];
  stats: {
    accountAgeDays: number;
    totalActivities: number;
    approvedActivities: number;
    blockedActivities: number;
    reviewedActivities: number;
    fraudRecidivismCount: number;
    distinctDevicesCount: number;
    linkedAccountsCount: number;
  };
}

export class ReputationEngine {
  /**
   * Reputation Engine: Calculates a permanent athlete Reputation Score (0–100).
   * Used as a weighted bias in risk evaluation.
   */
  static evaluate(userData: any = {}, userHistory: any[] = []): ReputationResult {
    let score = 70; // Base starting reputation for standard user
    const factors: ReputationFactor[] = [];

    // 1. Account Age
    const createdAt = userData.createdAt ? new Date(userData.createdAt).getTime() : Date.now();
    const accountAgeDays = Math.max(0, Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24)));

    if (accountAgeDays > 180) {
      score += 15;
      factors.push({ code: 'VETERAN_ACCOUNT', impact: 15, description: `Conta antiga e estabelecida (${accountAgeDays} dias).` });
    } else if (accountAgeDays > 60) {
      score += 10;
      factors.push({ code: 'MATURE_ACCOUNT', impact: 10, description: `Conta com histórico consistente (${accountAgeDays} dias).` });
    } else if (accountAgeDays < 7) {
      score -= 10;
      factors.push({ code: 'NEW_ACCOUNT', impact: -10, description: 'Conta recém-criada (menos de 7 dias).' });
    }

    // 2. Workout History & Approval Ratio
    const totalActivities = userHistory.length;
    let approvedActivities = 0;
    let blockedActivities = 0;
    let reviewedActivities = 0;
    let fraudRecidivismCount = 0;

    userHistory.forEach((act: any) => {
      const decision = act.securityDecision || act.status;
      if (decision === 'APPROVED' || decision === 'PARTIALLY_APPROVED' || decision === 'validated') {
        approvedActivities++;
      } else if (decision === 'BLOCKED' || decision === 'rejected') {
        blockedActivities++;
        if (act.fraudEvidences && act.fraudEvidences.length > 0) {
          fraudRecidivismCount++;
        }
      } else if (decision === 'UNDER_REVIEW') {
        reviewedActivities++;
      }
    });

    if (totalActivities >= 20) {
      const approvalRate = approvedActivities / totalActivities;
      if (approvalRate >= 0.95) {
        score += 15;
        factors.push({ code: 'HIGH_APPROVAL_RATE', impact: 15, description: `Taxa de aprovação exemplar (${Math.round(approvalRate * 100)}%).` });
      } else if (approvalRate < 0.70) {
        score -= 20;
        factors.push({ code: 'LOW_APPROVAL_RATE', impact: -20, description: `Histórico com alta proporção de rejeições (${Math.round(approvalRate * 100)}%).` });
      }
    }

    // 3. Fraud Recidivism Penalty
    if (fraudRecidivismCount > 0) {
      const penalty = Math.min(50, fraudRecidivismCount * 25);
      score -= penalty;
      factors.push({ code: 'FRAUD_RECIDIVISM', impact: -penalty, description: `Reincidência em tentativas de fraude (${fraudRecidivismCount} ocorrências).` });
    }

    // 4. Device Volatility & Linked Accounts
    const distinctDevicesCount = new Set(userHistory.map((a: any) => a.deviceFingerprint || a.deviceInfo?.model).filter(Boolean)).size;
    if (distinctDevicesCount > 5) {
      score -= 15;
      factors.push({ code: 'HIGH_DEVICE_TURNOVER', impact: -15, description: `Utilização de número elevado de dispositivos distintos (${distinctDevicesCount}).` });
    }

    const linkedAccountsCount = Number(userData.linkedAccountsCount || 1);
    if (linkedAccountsCount > 2) {
      score -= 15;
      factors.push({ code: 'MULTIPLE_LINKED_ACCOUNTS', impact: -15, description: 'Múltiplas contas associadas no mesmo ecossistema.' });
    }

    // 5. Account Status & Complaints
    if (userData.status === 'BANNED' || userData.isSuspended) {
      score = 0;
      factors.push({ code: 'ADMIN_SANCTION', impact: -100, description: 'Usuário sob sanção disciplinar administrativa.' });
    }

    if (userData.userReportsCount && userData.userReportsCount > 0) {
      const reportPenalty = Math.min(30, userData.userReportsCount * 10);
      score -= reportPenalty;
      factors.push({ code: 'COMMUNITY_REPORTS', impact: -reportPenalty, description: `Denúncias recebidas na comunidade (${userData.userReportsCount}).` });
    }

    // Clamp score
    const reputationScore = Math.max(0, Math.min(100, Math.round(score)));

    let reputationTier: 'ELITE' | 'TRUSTED' | 'STANDARD' | 'SUSPECT' | 'BANNED' = 'STANDARD';
    if (reputationScore >= 90) reputationTier = 'ELITE';
    else if (reputationScore >= 75) reputationTier = 'TRUSTED';
    else if (reputationScore >= 50) reputationTier = 'STANDARD';
    else if (reputationScore >= 20) reputationTier = 'SUSPECT';
    else reputationTier = 'BANNED';

    return {
      reputationScore,
      reputationTier,
      factors,
      stats: {
        accountAgeDays,
        totalActivities,
        approvedActivities,
        blockedActivities,
        reviewedActivities,
        fraudRecidivismCount,
        distinctDevicesCount,
        linkedAccountsCount
      }
    };
  }
}
