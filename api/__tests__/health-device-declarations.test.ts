import { applyUserDeclaredDeviceFromList, UserDeclaredHealthDevice } from '../_lib/health-device-registry';

const declarations: UserDeclaredHealthDevice[] = [
  {
    id: 'old', userId: 'u1', integration: 'APPLE_HEALTH', brand: 'Apple', model: 'Watch Series 7',
    effectiveFrom: '2025-01-01T00:00:00.000Z', effectiveTo: '2026-01-01T00:00:00.000Z',
    status: 'closed', createdAt: '2025-01-01T00:00:00.000Z'
  },
  {
    id: 'new', userId: 'u1', integration: 'APPLE_HEALTH', brand: 'Apple', model: 'Watch Series 10',
    effectiveFrom: '2026-01-01T00:00:01.000Z', effectiveTo: null,
    status: 'active', createdAt: '2026-01-01T00:00:01.000Z'
  }
];

describe('declarações temporais de dispositivo', () => {
  test('troca de relógio respeita o período de cada declaração', () => {
    const base = { integration: 'APPLE_HEALTH' as const, status: 'UNKNOWN_DEVICE' as const };
    expect(applyUserDeclaredDeviceFromList(base, '2025-06-01T00:00:00.000Z', declarations).deviceModel).toBe('Watch Series 7');
    expect(applyUserDeclaredDeviceFromList(base, '2026-06-01T00:00:00.000Z', declarations).deviceModel).toBe('Watch Series 10');
  });

  test('identificação técnica prevalece sobre conflito manual', () => {
    const technical = { integration: 'APPLE_HEALTH' as const, deviceModel: 'Watch Ultra 2', status: 'VERIFIED_DEVICE' as const };
    expect(applyUserDeclaredDeviceFromList(technical, '2026-06-01T00:00:00.000Z', declarations)).toEqual(technical);
  });

  test('declaração de outra integração não é aplicada', () => {
    const android = { integration: 'HEALTH_CONNECT' as const, status: 'UNKNOWN_DEVICE' as const };
    expect(applyUserDeclaredDeviceFromList(android, '2026-06-01T00:00:00.000Z', declarations)).toEqual(android);
  });
});
