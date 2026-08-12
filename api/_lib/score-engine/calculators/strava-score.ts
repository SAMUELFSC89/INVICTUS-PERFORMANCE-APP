export function normalizeStravaPayload(stravaActivity: any) {
  const distanceKm = (stravaActivity.distance || 0) / 1000;
  const movingTime = stravaActivity.moving_time || 0;
  
  return {
    id: stravaActivity.id?.toString(),
    type: 'run',
    duration: Math.round(movingTime / 60),
    distanceKm,
    avgSpeed: stravaActivity.average_speed || 0,
    hasGps: !!(stravaActivity.map?.summary_polyline || stravaActivity.map?.polyline),
    manual: !!stravaActivity.manual,
    stravaActivityId: stravaActivity.id
  };
}
