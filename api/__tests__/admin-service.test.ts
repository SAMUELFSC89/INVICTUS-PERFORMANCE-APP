import { AdminService } from '../_services/admin/admin-service.js';
import { AdminRepository } from '../_repositories/admin-repository.js';

describe('AdminService', () => {
  let adminService: AdminService;
  let mockAdminRepo: jest.Mocked<AdminRepository>;

  beforeEach(() => {
    mockAdminRepo = {
      getLogs: jest.fn().mockResolvedValue([{ id: 'log1', message: 'test' }]),
      getSystemAlerts: jest.fn().mockResolvedValue([]),
      findWorkoutById: jest.fn(),
      reviewWorkoutTransaction: jest.fn().mockResolvedValue(undefined),
      getWithdrawals: jest.fn().mockResolvedValue([]),
      updateWithdrawalStatus: jest.fn().mockResolvedValue(undefined),
      upsertDocument: jest.fn().mockResolvedValue('doc123'),
    } as any;

    adminService = new AdminService(mockAdminRepo);
  });

  test('getLogs should return logs from repository', async () => {
    const result = await adminService.getLogs('system_logs', 10);
    expect(result.logs).toBeDefined();
    expect(Array.isArray(result.logs)).toBe(true);
  });

  test('reviewActivity should throw AppError if activity not found', async () => {
    mockAdminRepo.findWorkoutById.mockResolvedValue(null);

    await expect(
      adminService.reviewActivity('reviewer1', {
        activityId: 'invalid_id',
        status: 'valid'
      })
    ).rejects.toThrow('Atividade física não encontrada.');
  });

  test('reviewActivity should execute transaction when activity exists', async () => {
    mockAdminRepo.findWorkoutById.mockResolvedValue({
      id: 'act1',
      userId: 'user1',
      points: 50,
      type: 'workout'
    });

    const res = await adminService.reviewActivity('reviewer1', {
      activityId: 'act1',
      status: 'valid',
      resolution: 'Aprovado'
    });

    expect(res.success).toBe(true);
    expect(res.adjustedPoints).toBe(80);
    expect(mockAdminRepo.reviewWorkoutTransaction).toHaveBeenCalledWith(
      'act1',
      'user1',
      'valid',
      80,
      50,
      'reviewer1',
      'Aprovado'
    );
  });

  test('upsertEntity should delegate to repository with collection mapping', async () => {
    const res = await adminService.upsertEntity('mission', 'm1', { title: 'Nova Missão' });
    expect(res.success).toBe(true);
    expect(res.id).toBe('doc123');
    expect(mockAdminRepo.upsertDocument).toHaveBeenCalledWith('missions', 'm1', { title: 'Nova Missão' });
  });
});
