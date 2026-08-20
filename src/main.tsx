import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';

// #223: o app instalou no iPhone mas mostrava "Erro Critico de Inicializacao /
// Script error. :0:0". Duas falhas no handler antigo:
//
//   1. Usava apenas "msg" e ignorava o objeto "error" -- e num WebView um erro
//      vindo de outra origem chega mascarado como "Script error." sem arquivo
//      nem linha. O erro verdadeiro ficava invisivel.
//   2. Substituia TODO o #root no primeiro erro global, mesmo depois do app ja
//      ter montado e mesmo para erros nao fatais. Qualquer falha assincrona
//      tardia matava a tela inteira.
//
// Agora so assumimos a tela se o app ainda NAO montou (crash real de boot);
// depois disso quem trata e o GlobalErrorBoundary. E sempre mostramos o stack
// real com botao de copiar -- essencial para depurar no iPhone, onde nao ha
// console acessivel sem um Mac.

let appMontou = false;

function descreverErro(origem: string, bruto: unknown, arquivo?: string, linha?: number, coluna?: number) {
  const err = bruto as any;
  const detalhe =
    (err && (err.stack || err.message)) ||
    (typeof bruto === 'string' ? bruto : '') ||
    'Erro desconhecido (sem detalhes disponiveis)';
  const local = arquivo ? '\n\nem ' + arquivo + ':' + (linha ?? 0) + ':' + (coluna ?? 0) : '';
  return '[' + origem + ']\n' + detalhe + local;
}

function mostrarTelaDeErro(texto: string) {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = '';

  const box = document.createElement('div');
  box.style.cssText = 'padding:24px;color:#fff;background:#111;font-family:-apple-system,sans-serif;min-height:100vh;box-sizing:border-box';

  const h = document.createElement('h1');
  h.textContent = 'Erro ao iniciar o INVICTUS';
  h.style.cssText = 'font-size:20px;margin:0 0 8px';

  const sub = document.createElement('p');
  sub.textContent = 'Copie o texto abaixo e envie para o suporte.';
  sub.style.cssText = 'font-size:13px;opacity:.7;margin:0 0 16px';

  const pre = document.createElement('pre');
  pre.textContent = texto;
  pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-size:12px;background:#000;border:1px solid #333;border-radius:8px;padding:12px;max-height:50vh;overflow:auto;user-select:text;-webkit-user-select:text';

  const btn = document.createElement('button');
  btn.textContent = 'Copiar erro';
  btn.style.cssText = 'margin-top:16px;padding:14px 20px;font-size:15px;font-weight:700;border:0;border-radius:10px;background:#EAB308;color:#000;width:100%';
  btn.onclick = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(texto).then(
        () => { btn.textContent = 'Copiado!'; },
        () => { btn.textContent = 'Selecione o texto acima para copiar'; }
      );
    } else {
      btn.textContent = 'Selecione o texto acima para copiar';
    }
  };

  box.appendChild(h);
  box.appendChild(sub);
  box.appendChild(pre);
  box.appendChild(btn);
  root.appendChild(box);
}

window.addEventListener('error', (ev) => {
  const texto = descreverErro('erro', ev.error ?? ev.message, ev.filename, ev.lineno, ev.colno);
  console.error(texto);
  if (!appMontou) mostrarTelaDeErro(texto);
});

window.addEventListener('unhandledrejection', (ev) => {
  const texto = descreverErro('promise rejeitada', ev.reason);
  console.error(texto);
  if (!appMontou) mostrarTelaDeErro(texto);
});

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <GlobalErrorBoundary>
        <App />
      </GlobalErrorBoundary>
    </StrictMode>,
  );
  // Render sincrono passou: o boot deu certo. A partir daqui erros pontuais
  // nao devem mais derrubar a tela toda.
  setTimeout(() => { appMontou = true; }, 3000);
} catch (e) {
  mostrarTelaDeErro(descreverErro('falha no render inicial', e));
}
