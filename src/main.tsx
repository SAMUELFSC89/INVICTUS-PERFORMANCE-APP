// #223: NAO importe modulos da aplicacao aqui de forma estatica.
//
// O WebView do iOS serve os arquivos pelo esquema capacitor://localhost, que o
// WebKit trata como origem opaca. Consequencia: TODO erro que chega pelo
// window.onerror vem sanitizado como "Script error." -- sem objeto Error, sem
// arquivo, sem linha, sem stack. Nao existe handler global capaz de recuperar
// essa informacao.
//
// Por isso o app inteiro entra por um import DINAMICO (./boot): qualquer falha
// na avaliacao da arvore de modulos vira uma rejeicao de promise com o Error
// verdadeiro, capturada pelo catch la embaixo.

let appMontou = false;
let avisoNaTela = false;

// O #root ter filhos e a prova de que o React realmente pintou alguma coisa.
// Usamos isso, e nao um temporizador, para decidir se a tela de erro pode ou
// nao tomar conta do app.
function appJaRenderizou(): boolean {
  const root = document.getElementById('root');
  return !!root && root.childElementCount > 0;
}

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
  box.style.cssText =
    'padding:24px;color:#fff;background:#111;font-family:-apple-system,sans-serif;min-height:100vh;box-sizing:border-box';

  const h = document.createElement('h1');
  h.textContent = 'Erro ao iniciar o INVICTUS';
  h.style.cssText = 'font-size:20px;margin:0 0 8px';

  const sub = document.createElement('p');
  sub.textContent = 'Copie o texto abaixo e envie para o suporte.';
  sub.style.cssText = 'font-size:13px;opacity:.7;margin:0 0 16px';

  const pre = document.createElement('pre');
  pre.textContent = texto;
  pre.style.cssText =
    'white-space:pre-wrap;word-break:break-word;font-size:12px;background:#000;border:1px solid #333;border-radius:8px;padding:12px;max-height:50vh;overflow:auto;user-select:text;-webkit-user-select:text';

  const btn = document.createElement('button');
  btn.textContent = 'Copiar erro';
  btn.style.cssText =
    'margin-top:16px;padding:14px 20px;font-size:15px;font-weight:700;border:0;border-radius:10px;background:#EAB308;color:#000;width:100%';
  btn.onclick = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(texto).then(
        () => { btn.textContent = 'Copiado!'; },
        () => { btn.textContent = 'Selecione o texto acima para copiar'; },
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

// Quando o app JA esta na tela, um erro global nao pode destruir a interface.
// Mostramos so um aviso discreto embaixo, que da para dispensar.
function mostrarAvisoDiscreto(texto: string) {
  if (avisoNaTela) return;
  avisoNaTela = true;

  const barra = document.createElement('div');
  barra.style.cssText =
    'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#1c1c1c;border:1px solid #444;' +
    'border-radius:10px;padding:10px 12px;color:#eee;font-family:-apple-system,sans-serif;font-size:12px;' +
    'display:flex;gap:8px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,.4)';

  const msg = document.createElement('div');
  msg.textContent = 'Um erro foi registrado em segundo plano.';
  msg.style.cssText = 'flex:1;line-height:1.35';

  const copiar = document.createElement('button');
  copiar.textContent = 'Copiar';
  copiar.style.cssText = 'padding:6px 10px;font-size:12px;font-weight:700;border:0;border-radius:6px;background:#EAB308;color:#000';
  copiar.onclick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(texto).then(() => { copiar.textContent = 'Copiado'; }, () => {});
  };

  const fechar = document.createElement('button');
  fechar.textContent = 'Fechar';
  fechar.style.cssText = 'padding:6px 10px;font-size:12px;border:0;border-radius:6px;background:#333;color:#eee';
  fechar.onclick = () => { barra.remove(); avisoNaTela = false; };

  barra.appendChild(msg);
  barra.appendChild(copiar);
  barra.appendChild(fechar);
  document.body.appendChild(barra);
}

// #223 - AQUI ESTAVA O BUG QUE DERRUBAVA O APP.
//
// A versao anterior liberava a tela de erro por 3 segundos apos o boot. Nesse
// intervalo QUALQUER erro global apagava o #root -- inclusive um erro
// assincrono e inofensivo, como uma chamada de rede que falhou. E como no iOS
// todo erro chega mascarado como "Script error.", era impossivel distinguir.
// Resultado: o app abria normalmente e era coberto pela propria tela de erro.
//
// Agora o criterio nao e tempo, e fato: se o React ja pintou alguma coisa no
// #root, a interface nunca e destruida.
function tratarErroGlobal(texto: string) {
  console.error(texto);
  if (!appMontou && !appJaRenderizou()) {
    mostrarTelaDeErro(texto);
  } else {
    mostrarAvisoDiscreto(texto);
  }
}

// Falha ao CARREGAR um arquivo (script/css) e um caso separado: o evento traz
// ev.target apontando para o elemento e a URL NAO e sanitizada. Precisa de
// capture=true, porque erro de recurso nao sobe na fase de bubbling.
window.addEventListener('error', (ev) => {
  const alvo = ev.target as any;
  if (alvo && alvo !== window) {
    if (alvo.tagName === 'SCRIPT' || alvo.tagName === 'LINK') {
      const url = alvo.src || alvo.href || '(sem url)';
      // Apenas registrar erro global se o app ainda não inicializou
      if (!appMontou && !appJaRenderizou()) {
        tratarErroGlobal(
          '[falha ao carregar arquivo]\n' + alvo.tagName + ': ' + url +
          '\n\nO WebView nao conseguiu baixar este arquivo.'
        );
      } else {
        console.warn('[falha ao carregar recurso]', alvo.tagName, url);
      }
    }
    // Erros em elementos como <img>, <video>, <audio>, etc. são normais e nunca devem derrubar a aplicação
    return;
  }

  const rawMsg = ev.message || (ev.error && (ev.error.message || ev.error.stack)) || '';
  if (typeof rawMsg === 'string') {
    if (
      rawMsg.includes('ResizeObserver') ||
      rawMsg.includes('Script error.') ||
      rawMsg.includes('AbortError') ||
      rawMsg.includes('canceled')
    ) {
      console.warn('[aviso do navegador ignorado]', rawMsg);
      return;
    }
  }

  // Se o evento não possui detalhes de erro e o app já está montado/renderizado, não disparar aviso de "Erro desconhecido"
  if (!ev.error && !ev.message) {
    console.warn('[evento de erro sem detalhes]', ev);
    return;
  }

  tratarErroGlobal(descreverErro('erro', ev.error ?? ev.message, ev.filename, ev.lineno, ev.colno));
}, true);

window.addEventListener('unhandledrejection', (ev) => {
  const motivo = ev.reason as any;
  if (motivo) {
    const msg = motivo.message || (typeof motivo === 'string' ? motivo : '');
    if (
      motivo.name === 'AbortError' ||
      msg.includes('aborted') ||
      msg.includes('ResizeObserver') ||
      msg.includes('canceled')
    ) {
      return;
    }
  } else if (appMontou || appJaRenderizou()) {
    console.warn('[rejeição de promise vazia]');
    return;
  }

  tratarErroGlobal(descreverErro('promise rejeitada', ev.reason));
});


// #227 - Painel de diagnostico removido: era temporario para a fase de
// TestFlight (#223) e nao pode ir para a App Store. A captura de erros
// acima (mostrarTelaDeErro / tratarErroGlobal) permanece: e ela que faz
// o WebView do iOS revelar o erro real em vez de "Script error." sem stack.

import('./apiNativa')
  .then(() => import('./boot'))
  .then(({ iniciarApp }) => {
    iniciarApp();
    // O render do React ja retornou sem lancar: o boot deu certo. Marcamos na
    // hora, sem temporizador -- era o temporizador que causava o bug acima.
    appMontou = true;
  })
  .catch((e) => {
    mostrarTelaDeErro(descreverErro('falha ao carregar o app', e));
  });