export interface AdminLogsRequest {
  category?: string;
  limit?: number;
}

export interface ReviewActivityRequest {
  activityId: string;
  status: 'valid' | 'invalid' | 'suspicious';
  resolution?: string;
}

export interface ReviewActivityResponse {
  success: boolean;
  activityId: string;
  status: string;
  adjustedPoints: number;
  message: string;
}

export interface UpdateWithdrawalRequest {
  withdrawalId: string;
  status: 'APPROVED' | 'REJECTED' | 'PAID';
  reason?: string;
}

export interface UpsertEntityRequest {
  id?: string;
  type: 'mission' | 'sponsor_challenge' | 'store_item';
  data: Record<string, any>;
}
