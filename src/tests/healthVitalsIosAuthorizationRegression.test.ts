import { Capacitor } from '@capacitor/core';
import { Health } from 'capgo-capacitor-health';
import { HealthVitalsProvider } from '../services/wearables/HealthVitalsProvider';

jest.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: jest.fn(), isNativePlatform: jest.fn() }
}));

jest.mock('capgo-capacitor-health', () => ({
  Health: {
    requestAuthorization: jest.fn(),
    checkAuthorization: jest.fn(),
    readSamples: jest.fn(),
    queryAggregated: jest.fn()
  }
}));

beforeEach(() => {
  jest.resetAllMocks();
  (Capacitor.getPlatform as jest.Mock).mockReturnValue('ios');
  (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
});

test('iOS prossegue após o consentimento mesmo sem readAuthorized exposto pelo HealthKit', async () => {
  (Health.requestAuthorization as jest.Mock).mockResolvedValue({
    readAuthorized: [],
    readDenied: [],
    writeAuthorized: [],
    writeDenied: []
  });

  await expect(HealthVitalsProvider.requestPermissions()).resolves.toBe(true);
  expect(Health.requestAuthorization).toHaveBeenCalledTimes(1);
});

test('Android ainda exige ao menos uma permissão de leitura confirmada', async () => {
  (Capacitor.getPlatform as jest.Mock).mockReturnValue('android');
  (Health.requestAuthorization as jest.Mock).mockResolvedValue({ readAuthorized: [], readDenied: ['heartRate'] });
  await expect(HealthVitalsProvider.requestPermissions()).resolves.toBe(false);
});
