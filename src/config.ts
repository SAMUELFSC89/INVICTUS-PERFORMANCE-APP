import { Capacitor } from '@capacitor/core';

// Dominio de producao do backend. Usado quando o app roda como app NATIVO
// (iOS/Android), onde nao existe "mesma origem" para cair de volta.
const PRODUCTION_API_URL = 'https://www.invictusperformance.app.br';

const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  const envUrlValido = envUrl && envUrl !== 'undefined' && envUrl !== 'null' && envUrl.length > 4;

  // #223: BUG CRITICO NO APP NATIVO.
  //
  // Dentro do Capacitor o WebView serve o app a partir de "capacitor://localhost"
  // (iOS) ou "http://localhost" (Android). Um caminho relativo como "/api/x"
  // resolve entao para "capacitor://localhost/api/x", que NAO EXISTE -- nao ha
  // servidor embutido no app. Resultado: no navegador tudo funciona (mesma
  // origem que o backend), mas no app instalado NENHUMA chamada de API funciona.
  //
  // Por isso, em plataforma nativa sempre usamos URL ABSOLUTA.
  if (Capacitor.isNativePlatform()) {
    return envUrlValido ? envUrl.replace(/\/$/, '') : PRODUCTION_API_URL;
  }

  // Preview do AI Studio (run.app): forca caminho relativo para evitar CORS
  // contra o dominio de producao.
  if (typeof window !== 'undefined' && window.location.origin.includes('run.app')) {
    return '';
  }

  if (envUrlValido) {
    return envUrl.replace(/\/$/, '');
  }

  // Na web, caminho relativo e o mais confiavel: front e backend na mesma
  // origem, sem CORS nem problema de SSL.
  return '';
};

export const API_CONFIG = {
  baseUrl: getBaseUrl(),
};

export const CHAMPIONSHIP_CONFIG = {
  ORGANIZER_NAME: 'Invictus Performance e Soluções Ltda.',
  ORGANIZER_CNPJ: (import.meta.env.VITE_CHAMPIONSHIP_ORGANIZER_CNPJ as string) || 'PENDENTE CONFIGURAÇÃO',
  PAID_CHAMPIONSHIPS_ANDROID: import.meta.env.VITE_PAID_CHAMPIONSHIPS_ANDROID !== 'false',
  APPLE_DISCLAIMER: 'Este campeonato é promovido e administrado pela Invictus Performance e Soluções Ltda. A Apple Inc. não é patrocinadora, organizadora, administradora ou participante deste campeonato e não possui qualquer responsabilidade relacionada à inscrição, classificação, premiação ou entrega dos prêmios.',
  NET_ELIGIBLE_REVENUE_DEFINITION: 'Receita Líquida Elegível corresponde à soma dos valores efetivamente recebidos e confirmados das inscrições do campeonato, deduzidos exclusivamente os tributos incidentes sobre a operação, taxas do meio de pagamento/Asaas, estornos, chargebacks, reembolsos e pagamentos cancelados ou não liquidados. Não serão deduzidos custos operacionais internos da Invictus, salvo se expressamente previstos no regulamento da edição.'
};

console.log('[API_CONFIG] baseUrl:', API_CONFIG.baseUrl || '(relativo)');
if (typeof window !== 'undefined') {
  console.log('[API_CONFIG] origin:', window.location.origin);
  console.log('[API_CONFIG] nativo?', Capacitor.isNativePlatform(), '| plataforma:', Capacitor.getPlatform());
}
