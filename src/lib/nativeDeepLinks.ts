export type NativeDeepLinkRoute = '/activity/ongoing';

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

/**
 * Resolve apenas deep links de navegação explicitamente pertencentes ao app.
 * OAuth (Strava/Firebase) continua sendo tratado pelo MobileBridge porque
 * precisa executar efeitos próprios antes/depois da navegação.
 */
export function resolveNativeDeepLinkRoute(rawUrl: string): NativeDeepLinkRoute | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol.toLowerCase() !== 'invictus:') return null;

    // URL(string: "invictus://activity") no widget vira host "activity".
    // Aceitamos somente esse destino conhecido; nenhum path/host arbitrário
    // de um esquema externo pode virar navegação interna do React Router.
    if (url.hostname.toLowerCase() === 'activity' && (url.pathname === '' || url.pathname === '/')) {
      return '/activity/ongoing';
    }
  } catch {
    // Deep link malformado: ignora sem interromper a inicialização do app.
  }
  return null;
}

/**
 * O callback nativo do Strava precisa carregar o destino original também no
 * cold start. Sem isso, o navegador devolve o controle ao app, mas uma WebView
 * recém-criada cai na Home e o evento de atualização pode disparar antes de a
 * tela de Dispositivos existir.
 */
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
