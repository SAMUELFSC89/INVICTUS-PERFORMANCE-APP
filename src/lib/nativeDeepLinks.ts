export type NativeDeepLinkRoute = '/activity/ongoing';

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
