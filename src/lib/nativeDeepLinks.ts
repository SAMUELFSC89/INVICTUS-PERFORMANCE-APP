export type ChampionshipCheckoutReturnStatus = 'success' | 'cancelled' | 'expired';
export type NativeDeepLinkRoute = '/activity/ongoing' | `/championships/checkout-return?status=${ChampionshipCheckoutReturnStatus}&championshipId=${string}`;

export interface NativeStravaCallback {
  outcome: 'connected' | 'error';
  returnPath: string;
}

function safeInternalPath(value: string | null, fallback: string): string {
  const candidate = (value || '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('://') || candidate.includes('\\')) {
    return fallback;
  }
  return candidate;
}

const PAID_CHAMPIONSHIP_IDS = new Set(['invictus_strength_v1', 'invictus_cardio_v1']);
const CHECKOUT_STATUSES = new Set<ChampionshipCheckoutReturnStatus>(['success', 'cancelled', 'expired']);

/**
 * Retorna somente a parte estrutural segura para diagnóstico. Query e fragment
 * nunca entram em logs porque callbacks OAuth podem transportar `code`,
 * `state`, `access_token` e identificadores de pagamento.
 */
export function describeNativeDeepLinkForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname ? `//${url.hostname}` : '';
    const path = url.pathname || '';
    return `${url.protocol}${host}${path}`.slice(0, 200);
  } catch {
    return '[native-url-invalida]';
  }
}

/** Resolve somente deep links internos explicitamente conhecidos. */
export function resolveNativeDeepLinkRoute(rawUrl: string): NativeDeepLinkRoute | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol.toLowerCase() !== 'invictus:') return null;

    if (url.hostname.toLowerCase() === 'activity' && (url.pathname === '' || url.pathname === '/')) {
      return '/activity/ongoing';
    }

    if (url.hostname.toLowerCase() === 'championship-checkout' && (url.pathname === '' || url.pathname === '/')) {
      const status = url.searchParams.get('status') as ChampionshipCheckoutReturnStatus | null;
      const championshipId = String(url.searchParams.get('championshipId') || '');
      if (!status || !CHECKOUT_STATUSES.has(status) || !PAID_CHAMPIONSHIP_IDS.has(championshipId)) return null;
      return `/championships/checkout-return?status=${status}&championshipId=${encodeURIComponent(championshipId)}`;
    }
  } catch {
    // Deep link malformado: ignora sem interromper a inicialização do app.
  }
  return null;
}

export function parseNativeStravaCallback(rawUrl: string): NativeStravaCallback | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol.toLowerCase() !== 'invictus:' || url.hostname.toLowerCase() !== 'strava-callback') return null;
    return {
      outcome: url.searchParams.get('strava') === 'error' ? 'error' : 'connected',
      returnPath: safeInternalPath(url.searchParams.get('returnPath'), '/profile/wearables'),
    };
  } catch {
    return null;
  }
}
