import { assessHealthConfidence, deriveProvenanceStatus } from '../_lib/health-confidence-engine';

const appleWatch = {
  integration: 'APPLE_HEALTH' as const, dataOrigin: 'com.apple.health', deviceManufacturer: 'Apple',
  deviceModel: 'Watch Series 9', deviceName: 'Apple Watch', status: 'VERIFIED_DEVICE' as const
};

describe('Invictus Health Confidence Engine', () => {
  test('Apple Watch identificado preserva evidência familiar sem alegar precisão clínica', () => {
    const result = assessHealthConfidence({ metricType: 'heart_rate_resting', provenance: appleWatch, measurementContext: 'resting', completeness: 'complete' });
    expect(result.confidenceLevel).toBe('A');
    expect(result.evidenceReferences.some((item) => item.scope === 'FAMILY_LEVEL')).toBe(true);
    expect(result.confidenceEngineVersion).toBe('1.0.0');
  });

  test('Apple Health sem device não é convertido em Apple Watch', () => {
    const provenance = { integration: 'APPLE_HEALTH' as const, dataOrigin: 'com.apple.Health', status: 'UNKNOWN_DEVICE' as const };
    const result = assessHealthConfidence({ metricType: 'heart_rate', provenance });
    expect(result.provenanceStatus).toBe('UNKNOWN_DEVICE');
    expect(result.confidenceReason).toContain('não identificada');
  });

  test('iPhone tecnicamente identificado não é classificado como Apple Watch', () => {
    const provenance = { integration: 'APPLE_HEALTH' as const, deviceManufacturer: 'Apple', deviceModel: 'iPhone', deviceType: 'phone', status: 'VERIFIED_DEVICE' as const };
    const result = assessHealthConfidence({ metricType: 'steps_daily', provenance });
    expect(result.evidenceReferences.some((item) => item.id === 'apple-watch-living-review-2026')).toBe(false);
  });

  test('Health Connect Samsung identificado mantém proveniência técnica', () => {
    const provenance = { integration: 'HEALTH_CONNECT' as const, dataOrigin: 'com.samsung.android.health', deviceManufacturer: 'Samsung', deviceModel: 'Galaxy Watch6', deviceType: 'watch', status: 'VERIFIED_DEVICE' as const };
    const result = assessHealthConfidence({ metricType: 'heart_rate', provenance, measurementContext: 'exercise' });
    expect(result.provenanceStatus).toBe('VERIFIED_DEVICE');
    expect(result.confidenceScore).toBeGreaterThanOrEqual(50);
  });

  test.each([
    [{ integration: 'HEALTH_CONNECT' as const, deviceModel: 'Watch6', status: 'VERIFIED_DEVICE' as const }, 'VERIFIED_DEVICE'],
    [{ integration: 'HEALTH_CONNECT' as const, deviceManufacturer: 'Samsung', status: 'VERIFIED_DEVICE' as const }, 'VERIFIED_DEVICE'],
    [{ integration: 'HEALTH_CONNECT' as const, dataOrigin: 'app.example', status: 'UNKNOWN_DEVICE' as const }, 'UNKNOWN_DEVICE']
  ])('campos opcionais não quebram a classificação', (provenance, status) => {
    expect(assessHealthConfidence({ metricType: 'steps_daily', provenance }).provenanceStatus).toBe(status);
  });

  test('identificação manual permanece declaração, não verificação', () => {
    const provenance = { integration: 'HEALTH_CONNECT' as const, deviceManufacturer: 'Samsung', deviceModel: 'Galaxy Watch7', status: 'USER_DECLARED_DEVICE' as const };
    const result = assessHealthConfidence({ metricType: 'heart_rate', provenance });
    expect(result.provenanceStatus).toBe('USER_DECLARED_DEVICE');
    expect(result.limitations.join(' ')).toContain('informado pelo usuário');
  });

  test('automático vence conflito manual para novos registros', () => {
    expect(deriveProvenanceStatus({ integration: 'HEALTH_CONNECT', deviceManufacturer: 'Samsung', deviceModel: 'Galaxy Watch6' })).toBe('VERIFIED_DEVICE');
  });

  test('productType técnico do HealthKit identifica a origem sem inventar modelo', () => {
    expect(deriveProvenanceStatus({ integration: 'APPLE_HEALTH', sourceProductType: 'Watch6,18' })).toBe('VERIFIED_DEVICE');
  });

  test('troca de relógio é avaliada por amostra e não por perfil global', () => {
    const six = assessHealthConfidence({ metricType: 'heart_rate', provenance: { ...appleWatch, deviceModel: 'Watch Series 6' } });
    const nine = assessHealthConfidence({ metricType: 'heart_rate', provenance: { ...appleWatch, deviceModel: 'Watch Series 9' } });
    expect(six.confidenceEngineVersion).toBe(nine.confidenceEngineVersion);
    expect(six.confidenceReason).not.toBe(nine.confidenceReason);
  });

  test('matriz inicial produz classes alta, moderada e limitada', () => {
    expect(assessHealthConfidence({ metricType: 'heart_rate_resting', provenance: appleWatch, measurementContext: 'resting' }).confidenceLevel).toBe('A');
    expect(assessHealthConfidence({ metricType: 'vo2max_estimate', provenance: appleWatch }).confidenceLevel).toBe('C');
    expect(assessHealthConfidence({ metricType: 'calories_active', provenance: appleWatch }).confidenceLevel).toBe('D');
  });

  test('métrica derivada nunca supera a fonte mais fraca', () => {
    const result = assessHealthConfidence({ metricType: 'dietary_energy_kcal', provenance: appleWatch, measurementContext: 'derived', derivedFrom: ['calories_active'], sourceConfidence: [37] });
    expect(result.confidenceScore).toBeLessThanOrEqual(37);
    expect(['D', 'E']).toContain(result.confidenceLevel);
  });

  test('evidência inexistente é transparente', () => {
    const result = assessHealthConfidence({ metricType: 'hydration_l', provenance: { integration: 'HEALTH_CONNECT', status: 'UNKNOWN_DEVICE' } }, []);
    expect(result.evidenceReferences).toHaveLength(0);
    expect(result.confidenceLevel).toBe('E');
  });

  test('registro legado não recebe dispositivo inventado', () => {
    const provenance = { integration: 'APPLE_HEALTH' as const, status: 'LEGACY_UNKNOWN_SOURCE' as const };
    const result = assessHealthConfidence({ metricType: 'heart_rate', provenance, completeness: 'minimal' });
    expect(result.provenanceStatus).toBe('LEGACY_UNKNOWN_SOURCE');
    expect(result.limitations.join(' ')).toContain('não foi identificado');
  });
});
