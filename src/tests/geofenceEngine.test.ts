import { validateGeofenceCheckin, calculateHaversineDistanceMeters } from '../services/geofenceEngine';

/**
 * Automated Geofence Engine Test Suite
 */
export function runGeofenceTests() {
  console.log('🧪 Iniciando suíte de testes do Geofence Engine...\n');

  const GYM_REF = {
    name: 'Academia Invictus Testes',
    latitude: -23.550520,
    longitude: -46.633308
  };

  // Helper to convert meter offset along latitude
  const latOffset = (meters: number) => GYM_REF.latitude + (meters / 111000);

  let passedCount = 0;
  let failedCount = 0;

  function assertTest(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${name}${details ? ` -> ${details}` : ''}`);
      failedCount++;
    }
  }

  // 1. Usuário a 5 metros -> Aprovar
  {
    const res = validateGeofenceCheckin(GYM_REF, {
      latitude: latOffset(5),
      longitude: GYM_REF.longitude,
      accuracy: 10
    });
    assertTest('Usuário a 5 metros → Aprovar', res.approved && res.status === 'eligible', `Distance: ${res.distanceMeters}m`);
  }

  // 2. Usuário a 40 metros -> Aprovar
  {
    const res = validateGeofenceCheckin(GYM_REF, {
      latitude: latOffset(40),
      longitude: GYM_REF.longitude,
      accuracy: 15
    });
    assertTest('Usuário a 40 metros → Aprovar', res.approved && res.status === 'eligible', `Distance: ${res.distanceMeters}m`);
  }

  // 3. Usuário a 79 metros -> Aprovar
  {
    const res = validateGeofenceCheckin(GYM_REF, {
      latitude: latOffset(79),
      longitude: GYM_REF.longitude,
      accuracy: 20
    });
    assertTest('Usuário a 79 metros → Aprovar', res.approved && res.status === 'eligible', `Distance: ${res.distanceMeters}m`);
  }

  // 4. Usuário a 81 metros -> Reprovar
  {
    const res = validateGeofenceCheckin(GYM_REF, {
      latitude: latOffset(81),
      longitude: GYM_REF.longitude,
      accuracy: 10
    });
    assertTest('Usuário a 81 metros → Reprovar', !res.approved && res.status === 'blocked_out_of_range', `Status: ${res.status}`);
  }

  // 5. Usuário a 150 metros -> Reprovar
  {
    const res = validateGeofenceCheckin(GYM_REF, {
      latitude: latOffset(150),
      longitude: GYM_REF.longitude,
      accuracy: 10
    });
    assertTest('Usuário a 150 metros → Reprovar', !res.approved && res.status === 'blocked_out_of_range', `Status: ${res.status}`);
  }

  // 6. Accuracy 60 m -> Reprovar
  {
    const res = validateGeofenceCheckin(GYM_REF, {
      latitude: latOffset(10),
      longitude: GYM_REF.longitude,
      accuracy: 60
    });
    assertTest('Accuracy 60 m → Reprovar', !res.approved && res.status === 'blocked_low_accuracy', `Status: ${res.status}`);
  }

  // 7. Coordenadas inválidas -> Reprovar
  {
    const res = validateGeofenceCheckin(GYM_REF, {
      latitude: 'invalido' as any,
      longitude: -46.633308,
      accuracy: 10
    });
    assertTest('Coordenadas inválidas → Reprovar', !res.approved && res.status === 'blocked_invalid_coords', `Status: ${res.status}`);
  }

  // 8. GPS indisponível -> Reprovar
  {
    const res = validateGeofenceCheckin(GYM_REF, null);
    assertTest('GPS indisponível → Reprovar', !res.approved && res.status === 'blocked_no_permission', `Status: ${res.status}`);
  }

  // 9. Localização em cache -> Reprovar
  {
    const res = validateGeofenceCheckin(GYM_REF, {
      latitude: GYM_REF.latitude,
      longitude: GYM_REF.longitude,
      accuracy: 10,
      isCached: true
    });
    assertTest('Localização em cache → Reprovar', !res.approved && res.status === 'blocked_cached_location', `Status: ${res.status}`);
  }

  // 10. Mock location -> Reprovar
  {
    const res = validateGeofenceCheckin(GYM_REF, {
      latitude: GYM_REF.latitude,
      longitude: GYM_REF.longitude,
      accuracy: 10,
      isMock: true
    });
    assertTest('Mock location → Reprovar', !res.approved && res.status === 'blocked_mock_location', `Status: ${res.status}`);
  }

  console.log(`\n📊 Resultado dos Testes: ${passedCount} aprovados, ${failedCount} falhas.`);
  return { passed: passedCount, failed: failedCount };
}

// Execute tests if invoked via Jest or tsx CLI
describe('Geofence Engine Tests', () => {
  it('runs geofence test suite without failures', () => {
    const result = runGeofenceTests();
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(0);
  });
});

if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].includes('geofenceEngine.test')) {
  const result = runGeofenceTests();
  if (result.failed > 0) {
    process.exit(1);
  }
}
