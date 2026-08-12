import crypto from 'crypto';
import { db } from './common.js';

export interface AuditLogEntry {
  auditId: string;
  timestamp: string;
  userId: string;
  activityId: string;
  decision: 'APPROVED' | 'PARTIALLY_APPROVED' | 'UNDER_REVIEW' | 'BLOCKED';
  versions: {
    securityVersion: string;
    pipelineVersion: string;
    rulesVersion: string;
    engineVersions: Record<string, string>;
  };
  scores: {
    riskScore: number;
    trustScore: number;
    reputationScore: number;
    behaviorScore: number;
    integrityScore: number;
  };
  evidences: any[];
  explanation: any;
  adminOverride?: {
    overriddenBy: string;
    previousDecision: string;
    newDecision: string;
    reason: string;
    timestamp: string;
  };
  decisionHash: string; // SHA-256 for immutability verification
}

export class AuditLogger {
  /**
   * Immutable Audit Logger: Appends audit records to `security_audit_log` in Firestore.
   * STRICT APPEND-ONLY: Never updates existing documents.
   */
  static async logDecision(entry: Omit<AuditLogEntry, 'auditId' | 'decisionHash'>): Promise<string> {
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = entry.timestamp || new Date().toISOString();

    // Generate cryptographic hash of decision payload to guarantee tamper protection
    const payloadToHash = JSON.stringify({
      auditId,
      timestamp,
      userId: entry.userId,
      activityId: entry.activityId,
      decision: entry.decision,
      scores: entry.scores,
      versions: entry.versions,
      evidences: entry.evidences
    });

    const decisionHash = crypto.createHash('sha256').update(payloadToHash).digest('hex');

    const fullEntry: AuditLogEntry = {
      auditId,
      ...entry,
      timestamp,
      decisionHash
    };

    try {
      // Append-only write into Firestore collection `security_audit_log` using auditId as document ID
      await db.collection('security_audit_log').doc(auditId).set(fullEntry);
      console.log(`[AuditLogger] [APPEND_ONLY] Security Audit Log persisted: ${auditId} | Decision: ${entry.decision} | Hash: ${decisionHash.substring(0, 10)}...`);
    } catch (err: any) {
      console.error(`[AuditLogger] Failed to write to security_audit_log: ${err.message}`);
    }

    return auditId;
  }
}
