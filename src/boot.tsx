import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';

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
