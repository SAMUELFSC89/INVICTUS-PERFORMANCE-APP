import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
// #mapa-ios-2026-09-04: efeito colateral, sem exports usados aqui de proposito.
//
// Este modulo substitui window.navigator.geolocation por uma versao apoiada
// no plugin nativo @capacitor/geolocation quando Capacitor.isNativePlatform()
// e verdadeiro (na web ele nao faz nada). Antes desta linha, esse polyfill so
// era carregado se o usuario passasse pela tela de Perfil (unico import
// existente), entao quem abria Desafios > Cardio direto de um app recem-aberto
// no iOS caia no navigator.geolocation cru do WKWebView -- que no
// capacitor://localhost frequentemente nunca entrega nenhum fix de GPS.
// Resultado observado: DISTANCIA 00.00 e mapa preso no icone de alerta mesmo
// com TEMPO correndo. Importar aqui, no unico arquivo que "concentra TODOS os
// imports da aplicacao" (comentario abaixo), garante que o polyfill esteja
// instalado antes de qualquer tela pedir localizacao.
import './lib/locationUtils';

// #223: este arquivo concentra TODOS os imports da aplicacao.
//
// O main.tsx passou a carrega-lo por import dinamico dentro de um try/catch.
// Isso e o que garante que, se qualquer modulo da arvore do App quebrar
// durante a avaliacao, nos recebemos o objeto Error de verdade (com stack)
// em vez do "Script error." mascarado que o WebView do iOS entrega para o
// window.onerror quando o script vem do esquema capacitor://.

export function iniciarApp() {
  const root = document.getElementById('root');
  if (!root) throw new Error('Elemento #root nao encontrado no index.html');

  createRoot(root).render(
    <StrictMode>
      <GlobalErrorBoundary>
        <App />
      </GlobalErrorBoundary>
    </StrictMode>,
  );
}
