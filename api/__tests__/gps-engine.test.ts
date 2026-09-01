import { GpsEngine } from '../_lib/gps-engine';

const point = (lat: number, lng: number, seconds: number, segmentId: number) => ({
  timestamp: new Date(seconds * 1000).toISOString(),
  segmentId,
  location: { lat, lng, accuracy: 5 }
});

describe('GpsEngine', () => {
  it('reconstrói distância a partir dos checkpoints aceitos', () => {
    const report = GpsEngine.evaluate({
      type: 'cardio',
      cardioType: 'running',
      checkpoints: [
        point(-23.5505, -46.6333, 0, 0),
        point(-23.5514, -46.6333, 30, 0),
        point(-23.5523, -46.6333, 60, 0)
      ]
    });

    expect(report.verifiedDistanceKm).toBeGreaterThan(0.15);
    expect(report.verifiedDistanceKm).toBeLessThan(0.25);
    expect(report.hasTeleportation).toBe(false);
  });

  it('não conecta trechos separados por uma pausa', () => {
    const report = GpsEngine.evaluate({
      type: 'cardio',
      cardioType: 'running',
      checkpoints: [
        point(-23.5505, -46.6333, 0, 0),
        point(-23.5514, -46.6333, 30, 0),
        // Salto grande durante a pausa; deve ser ignorado como ligação entre
        // segmentos, não classificado como teleporte do atleta.
        point(-23.5600, -46.7000, 300, 1),
        point(-23.5609, -46.7000, 330, 1)
      ]
    });

    expect(report.hasTeleportation).toBe(false);
    expect(report.verifiedDistanceKm).toBeGreaterThan(0.15);
    expect(report.verifiedDistanceKm).toBeLessThan(0.25);
  });
});
