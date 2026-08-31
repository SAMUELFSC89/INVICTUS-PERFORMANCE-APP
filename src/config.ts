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
  PAID_CHAMPIONSHIPS_ANDROID: false,
  // #48: nome mantido por compatibilidade (ja referenciado em varios lugares),
  // mas o texto agora cobre as duas lojas -- antes so citava a Apple, e o
  // usuario apontou que a inscricao paga (fora do IAP/Play Billing, via
  // gateway externo Asaas) precisa deixar claro que NENHUMA das duas
  // patrocina o campeonato, nao so uma.
  APPLE_DISCLAIMER: 'O campeonato gratuito é promovido pela Invictus Performance, sem vínculo com academias, sem taxa de inscrição e sem premiação em dinheiro. Apple e Google não patrocinam nem administram a experiência.',
  NET_ELIGIBLE_REVENUE_DEFINITION: 'Não aplicável ao campeonato gratuito atual. Qualquer campeonato pago futuro exigirá regulamento, preço, premiação e condições comerciais próprios antes de ser ativado.'
};

// #251: espelho client-side de api/_lib/health-feature-flags.ts. Nao ha
// import compartilhado entre src/ e api/ neste projeto (bundles separados),
// por isso os dois arquivos precisam ser mantidos em sincronia manualmente --
// qualquer mudanca aqui deve ser replicada la e vice-versa. Ainda sem
// nenhuma tela lendo isso (Fase 1 e so a camada de dados no servidor); existe
// aqui para o dia em que Health.tsx precisar decidir o que mostrar sem
// duplicar a decisao de novo.
export const HEALTH_FEATURE_FLAGS = {
  healthReports: true,
  healthBaseline: true,
  healthInsights: true,
  professionalSharing: false,
  professionalDashboard: false,
  clinicalIntegrations: false,
  hospitalPortal: false
} as const;

console.log('[API_CONFIG] baseUrl:', API_CONFIG.baseUrl || '(relativo)');
if (typeof window !== 'undefined') {
  console.log('[API_CONFIG] origin:', window.location.origin);
  console.log('[API_CONFIG] nativo?', Capacitor.isNativePlatform(), '| plataforma:', Capacitor.getPlatform());
}
