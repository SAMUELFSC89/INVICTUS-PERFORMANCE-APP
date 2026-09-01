
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // meters
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

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [
    h > 0 ? h : null,
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0')
  ].filter(Boolean).join(':');
}

/**
 * Formata um ritmo sem a unidade, para que a interface possa escolher onde
 * exibir "/km". O cálculo usa segundos arredondados (em vez de truncados),
 * evitando que o último segundo de uma atividade mude o pace exibido.
 */
export function formatPaceValue(distanceKm: number, seconds: number): string | null {
  const km = Number(distanceKm);
  const elapsed = Number(seconds);
  if (!Number.isFinite(km) || !Number.isFinite(elapsed) || km <= 0 || elapsed <= 0) return null;

  const totalSeconds = Math.max(0, Math.round(elapsed / km));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}'${String(remainingSeconds).padStart(2, '0')}"`;
}

/** Converte a velocidade instantânea (km/h) no pace equivalente (min/km). */
export function formatPaceFromSpeed(speedKmH: number | null | undefined): string | null {
  const speed = Number(speedKmH);
  if (!Number.isFinite(speed) || speed <= 0.1) return null;
  return formatPaceValue(1, 3600 / speed);
}

export function calculatePace(meters: number, seconds: number): string {
  const pace = formatPaceValue(Number(meters) / 1000, seconds);
  return pace ? `${pace}/km` : "0'00\"/km";
}
