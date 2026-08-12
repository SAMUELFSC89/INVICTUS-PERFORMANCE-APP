import { BaseRepository } from './base-repository.js';

export interface AuditLog {
  id?: string;
  traceId: string;
  userId: string;
  action: string;
  details: Record<string, any>;
  result: 'SUCCESS' | 'FAILURE' | 'FLAGGED';
  timestamp?: string;
}

export class AuditRepository extends BaseRepository<AuditLog> {
  constructor() {
    super('security_audit_log');
  }

  async log(logEntry: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog> {
    return this.create({
      ...logEntry,
      timestamp: new Date().toISOString()
    });
  }
}
