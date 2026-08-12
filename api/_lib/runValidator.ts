
/**
 * Haversine formula to calculate distance between two points in meters
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export interface RunPoint {
  lat: number;
  lng: number;
  timestamp: number;
  speed: number;
  accuracy: number;
  altitude: number;
}

export interface RunValidationResult {
  score: number;
  status: 'VALID' | 'SUSPICIOUS' | 'INVALID';
  reasons: string[];
}

export function validateRunSession(points: RunPoint[]): RunValidationResult {
  const reasons: string[] = [];
  let score = 100;

  if (points.length < 2) {
    return { score: 0, status: 'INVALID', reasons: ['Dados de GPS insuficientes'] };
  }

  const startTime = points[0].timestamp;
  const endTime = points[points.length - 1].timestamp;
  const totalDurationSeconds = (endTime - startTime) / 1000;

  let totalDistance = 0;
  let maxInstSpeed = 0;
  let suspiciouslyFastPoints = 0;

  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    
    const dist = calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    totalDistance += dist;

    const timeDiff = (p2.timestamp - p1.timestamp) / 1000;
    if (timeDiff > 0) {
      const instSpeed = dist / timeDiff; // m/s
      if (instSpeed > maxInstSpeed) maxInstSpeed = instSpeed;
      
      // 25 km/h = 6.94 m/s
      if (instSpeed > 7.5) { // Giving a small buffer above 25km/h for GPS jitter (7.5 m/s approx 27 km/h)
        suspiciouslyFastPoints++;
      }
    }
  }

  const avgSpeedKmH = (totalDistance / totalDurationSeconds) * 3.6;

  // Rule A: Max Speed
  if (maxInstSpeed > 8.33) { // > 30 km/h is definitely not running
    score -= 40;
    reasons.push('Velocidade instatânea acima do limite humano de corrida');
  } else if (maxInstSpeed > 6.94) { // > 25 km/h
    score -= 20;
    reasons.push('Velocidade instatânea suspeita (>25km/h)');
  }

  // Rule D: Min Distance
  if (totalDistance < 1000) {
    score -= 50;
    reasons.push('Distância menor que 1km');
  }

  // Rule B: GPS Jumps / Suspiciously Fast Points
  if (suspiciouslyFastPoints > points.length * 0.1) {
    score -= 30;
    reasons.push('Múltiplos picos de velocidade detectados');
  }

  // Rule E: Consistency (Avg speed vs Max speed)
  if (avgSpeedKmH > 22) { // World record marathon speed is approx 21 km/h
    score -= 40;
    reasons.push('Velocidade média humanamente improvável');
  }

  // Status mapping
  let status: 'VALID' | 'SUSPICIOUS' | 'INVALID' = 'VALID';
  if (score < 40 || (totalDistance < 1000)) {
    status = 'INVALID';
  } else if (score < 80) {
    status = 'SUSPICIOUS';
  }

  return { 
    score: Math.max(0, score), 
    status, 
    reasons 
  };
}
