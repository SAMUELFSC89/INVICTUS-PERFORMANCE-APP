import { describe, it, expect } from '@jest/globals';
import { FraudDetectionEngine } from '../_lib/fraud-detection/index';
import { GPSValidator } from '../_lib/fraud-detection/gps-validator';

describe('Fraud Detection - GPS Validator', () => {
  it('should detect impossible speed', () => {
    const coordinates = [
      { lat: 40.7128, lng: -74.0060, timestamp: 1000 },
      { lat: 40.7580, lng: -73.9855, timestamp: 2000 } // ~5km away in 1 second = impossible speed (>10,000 km/h)
    ];

    const result = GPSValidator.validateActivity('user-123', coordinates, 50, 1);
    expect(result.fraudScore).toBeGreaterThan(0);
    expect(result.flags).toContain('IMPOSSIBLE_SPEED');
  });

  it('should accept normal running', () => {
    const coordinates = [
      { lat: 40.7128, lng: -74.0060, timestamp: 0 },
      { lat: 40.7138, lng: -74.0050, timestamp: 300000 } // ~100m em 5 minutos
    ];

    const result = GPSValidator.validateActivity('user-123', coordinates, 0.1, 300);
    expect(result.fraudScore).toBeLessThan(30);
    expect(result.isValid).toBe(true);
  });
});

describe('Fraud Detection - Complete Analysis', () => {
  it('should block obvious fraud', () => {
    const result = FraudDetectionEngine.analyzeActivity('user-123', {
      coordinates: [
        { lat: 0, lng: 0, timestamp: 0 },
        { lat: 80, lng: 170, timestamp: 1000 } // Teleporte instantâneo
      ],
      distance: 10000,
      duration: 1,
      userAgent: 'suspect-bot',
      ipAddress: '1.1.1.1',
      acceptLanguage: 'unknown'
    }, {});

    expect(result.shouldBlock).toBe(true);
    expect(result.recommendation).toBe('BLOCK');
  });

  it('should flag normal activity as ACCEPT', () => {
    const result = FraudDetectionEngine.analyzeActivity('user-123', {
      coordinates: [
        { lat: -23.5505, lng: -46.6333, timestamp: 0 },
        { lat: -23.5515, lng: -46.6343, timestamp: 300000 }
      ],
      distance: 0.2,
      duration: 300,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      ipAddress: '189.100.1.1',
      acceptLanguage: 'pt-BR'
    }, {});

    expect(result.shouldBlock).toBe(false);
    expect(['ACCEPT', 'REVIEW']).toContain(result.recommendation);
  });
});
