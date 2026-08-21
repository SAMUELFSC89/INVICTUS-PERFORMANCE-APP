import { Capacitor } from '@capacitor/core';
import { API_CONFIG } from './config';

// #229: NO APP NATIVO, TODA CHAMADA /api PRECISA VIRAR URL ABSOLUTA.
//
// O WebView do iOS/Android serve a aplicacao por capacitor://localhost. Nesse
// contexto um fetch('/api/validate-activity') resolve para
// capacitor://localhost/api/validate-activity -- um endereco que nao existe.
// A chamada falha e a tela cai no caminho de erro/fallback.
//
// Na web isso nunca apareceu porque o site e a API dividem a mesma origem.
//
// Havia 20 arquivos em src/ chamando a API por caminho relativo (cardio, IA,
// carteira, check-in, notificacoes, pagamentos, telas de admin). Em vez de
// editar os 20 e correr o risco de esquecer algum, o redirecionamento e feito
// aqui, num ponto so, antes de qualquer codigo da aplicacao rodar.
//
// IMPORTANTE: isto e uma rede de seguranca, nao a arquitetura ideal. O certo a
// longo prazo e cada servico montar a URL com API_CONFIG.baseUrl. Enquanto essa
// limpeza nao acontece, este interceptador garante que nada fique quebrado.

function instalarInterceptadorDeApi() {
  if (!Capacitor.isNativePlatform()) return;

  const base = (API_CONFIG.baseUrl || '').replace(/\/$/, '');
  if (!base) {
    console.warn('[API nativa] API_CONFIG.baseUrl vazio -- interceptador nao instalado.');
    return;
  }

  const fetchOriginal = window.fetch.bind(window);

  window.fetch = (entrada: any, init?: RequestInit) => {
    try {
      // Caso comum: fetch('/api/...')
      if (typeof entrada === 'string' && entrada.startsWith('/api')) {
        return fetchOriginal(base + entrada, init);
      }

      if (entrada instanceof URL && entrada.pathname.startsWith('/api')) {
        return fetchOriginal(base + entrada.pathname + entrada.search, init);
      }

      // Objeto Request ja construido com caminho relativo.
      if (typeof Request !== 'undefined' && entrada instanceof Request) {
        const u = new URL(entrada.url);
        if (u.pathname.startsWith('/api') && u.origin !== base) {
          return fetchOriginal(new Request(base + u.pathname + u.search, entrada), init);
        }
      }
    } catch (erro) {
      // Nunca deixe o interceptador derrubar uma chamada: se algo der errado
      // na reescrita, seguimos com a entrada original.
      console.warn('[API nativa] falha ao reescrever a URL, usando a original:', erro);
    }

    return fetchOriginal(entrada, init);
  };

  console.log('[API nativa] chamadas /api redirecionadas para ' + base);
}

instalarInterceptadorDeApi();
