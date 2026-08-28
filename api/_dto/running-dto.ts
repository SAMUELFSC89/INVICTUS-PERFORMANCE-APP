// #96: AddRunRequest e AddRunResponse foram removidos junto com
// RunningService.addRun() -- ver running-service.ts e running-repository.ts.

export interface GetRankingResponse {
  ranking: Array<{
    userId: string;
    displayName: string;
    photoURL?: string | null;
    km: number;
    is_paid_running?: boolean;
  }>;
  totalPool: number;
}
