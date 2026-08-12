export interface NetworkReport {
  networkRiskScore: number; // 0 - 100
  isVpnOrProxy: boolean;
  isTor: boolean;
  isDatacenter: boolean;
  impossibleTravelDetected: boolean;
  ipAddress?: string;
  asn?: string;
  countryCode?: string;
  networkThreats: string[];
}

export class NetworkEngine {
  /**
   * Network Security Engine: Detects VPN, Proxy, Tor, Datacenter IP, ASN risk, and impossible access travel.
   */
  static evaluate(req: any = {}, lastAccess?: { ip?: string; timestamp?: string; lat?: number; lng?: number }): NetworkReport {
    const networkThreats: string[] = [];
    let networkRiskScore = 0;

    // Extract headers
    const headers = req.headers || {};
    const ip = (
      headers['x-forwarded-for']?.split(',')[0] ||
      headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      req.ip ||
      '127.0.0.1'
    ).toString().trim();

    const userAgent = (headers['user-agent'] || '').toString().toLowerCase();
    const viaHeader = (headers['via'] || '').toString().toLowerCase();

    // 1. Proxy / VPN Header Signals
    const isVpnOrProxy = Boolean(
      headers['x-authenticated-user'] ||
      headers['x-proxy-id'] ||
      viaHeader.includes('proxy') ||
      viaHeader.includes('squid') ||
      headers['forwarded']
    );

    if (isVpnOrProxy) {
      networkRiskScore += 35;
      networkThreats.push('VPN_OR_PROXY_HEADER_DETECTED');
    }

    // 2. Suspicious Client Headers / Tor Signals
    const isTor = userAgent.includes('torbrowser') || headers['x-tor-exit-node'] === 'true';
    if (isTor) {
      networkRiskScore += 70;
      networkThreats.push('TOR_EXIT_NODE_DETECTED');
    }

    // 3. Datacenter IP or Automated Scraping User-Agents
    const isDatacenter = Boolean(
      userAgent.includes('curl') ||
      userAgent.includes('python') ||
      userAgent.includes('postman') ||
      userAgent.includes('insomnia') ||
      headers['x-cloud-trace-context'] && !headers['user-agent']
    );

    if (isDatacenter) {
      networkRiskScore += 40;
      networkThreats.push('AUTOMATED_CLIENT_DATACENTER_IP');
    }

    // 4. Impossible Travel Detection (Geographical distance vs Time delta)
    let impossibleTravelDetected = false;
    if (lastAccess && lastAccess.lat && lastAccess.lng && req.body?.latitude && req.body?.longitude) {
      const p1Lat = lastAccess.lat;
      const p1Lng = lastAccess.lng;
      const p2Lat = req.body.latitude;
      const p2Lng = req.body.longitude;

      const distKm = NetworkEngine.haversineKm(p1Lat, p1Lng, p2Lat, p2Lng);
      const timeSec = Math.abs((Date.now() - new Date(lastAccess.timestamp || Date.now()).getTime()) / 1000);

      if (timeSec > 0) {
        const speedKmH = (distKm / (timeSec / 3600));
        if (distKm > 100 && speedKmH > 900) { // Faster than commercial aircraft
          impossibleTravelDetected = true;
          networkRiskScore += 60;
          networkThreats.push(`IMPOSSIBLE_TRAVEL_BETWEEN_ACCESSES (${Math.round(distKm)}km in ${Math.round(timeSec)}s - ${Math.round(speedKmH)} km/h)`);
        }
      }
    }

    networkRiskScore = Math.min(100, networkRiskScore);

    return {
      networkRiskScore,
      isVpnOrProxy,
      isTor,
      isDatacenter,
      impossibleTravelDetected,
      ipAddress: ip,
      countryCode: headers['cf-ipcountry'] || headers['x-country-code'] || 'BR',
      networkThreats
    };
  }

  private static haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
