import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';

console.log('--- APP REBOOTED (NO EXTENSIONS) ---');

// Global error handler for early crashes
window.onerror = function(msg, url, line, col, error) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="padding: 20px; color: white; background: #800; font-family: sans-serif;">
        <h1>Erro Crítico de Inicialização</h1>
        <p>${msg}</p>
        <small>${url}:${line}:${col}</small>
      </div>
    `;
  }
  return false;
};

// Unregister any existing service workers to rule out caching issues
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </StrictMode>,
);
