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
  if (alvo && alvo !== window && (alvo.tagName === 'SCRIPT' || alvo.tagName === 'LINK')) {
    const url = alvo.src || alvo.href || '(sem url)';
    tratarErroGlobal(
      '[falha ao carregar arquivo]\n' + alvo.tagName + ': ' + url +
      '\n\nO WebView nao conseguiu baixar este arquivo.'
    );
    return;
  }

  tratarErroGlobal(descreverErro('erro', ev.error ?? ev.message, ev.filename, ev.lineno, ev.colno));
}, true);

window.addEventListener('unhandledrejection', (ev) => {
  tratarErroGlobal(descreverErro('promise rejeitada', ev.reason));
});


// #223 - PAINEL DE DIAGNOSTICO (temporario, fase de TestFlight).
//
// Nao existe console acessivel no iPhone sem um Mac. Este painel mostra os
// marcos do boot registrados em firebase.ts (window.__invictusDiag) para que o
// app consiga dizer sozinho ONDE ele parou, em vez de nos ficarmos adivinhando.
//
// REMOVER antes de publicar na App Store.
function textoDiagnostico(): string {
  const marcos = ((window as any).__invictusDiag as string[]) || [];
  const linhas = marcos.length ? marcos.join('\n') : '(nenhum marco registrado)';
  return [
    'DIAGNOSTICO INVICTUS',
    'plataforma: ' + navigator.platform,
    'origem: ' + location.origin,
    'montou: ' + appMontou + ' | renderizou: ' + appJaRenderizou(),
    '',
    'MARCOS DO BOOT:',
    linhas
  ].join('\n');
}

function mostrarPainelDiagnostico() {
  const anterior = document.getElementById('invictus-diag');
  if (anterior) anterior.remove();

  const texto = textoDiagnostico();

  const fundo = document.createElement('div');
  fundo.id = 'invictus-diag';
  fundo.style.cssText =
    'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.92);color:#fff;' +
    'font-family:-apple-system,sans-serif;padding:20px;box-sizing:border-box;overflow:auto';

  const h = document.createElement('h2');
  h.textContent = 'Diagnostico do INVICTUS';
  h.style.cssText = 'font-size:17px;margin:0 0 10px';

  const pre = document.createElement('pre');
  pre.textContent = texto;
  pre.style.cssText =
    'white-space:pre-wrap;word-break:break-word;font-size:12px;background:#000;border:1px solid #333;' +
    'border-radius:8px;padding:12px;user-select:text;-webkit-user-select:text';

  const copiar = document.createElement('button');
  copiar.textContent = 'Copiar diagnostico';
  copiar.style.cssText =
    'margin-top:14px;padding:14px;font-size:15px;font-weight:700;border:0;border-radius:10px;background:#EAB308;color:#000;width:100%';
  copiar.onclick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(texto).then(() => { copiar.textContent = 'Copiado!'; }, () => {});
  };

  const fechar = document.createElement('button');
  fechar.textContent = 'Fechar';
  fechar.style.cssText =
    'margin-top:8px;padding:12px;font-size:14px;border:0;border-radius:10px;background:#333;color:#eee;width:100%';
  fechar.onclick = () => fundo.remove();

  fundo.appendChild(h);
  fundo.appendChild(pre);
  fundo.appendChild(copiar);
  fundo.appendChild(fechar);
  document.body.appendChild(fundo);
}

(window as any).__invictusMostrarDiag = mostrarPainelDiagnostico;

// Se depois de 20 segundos o app ainda nao chegou a um estado util, oferece o
// diagnostico. Nao rouba a tela: e so uma barra que da para dispensar.
setTimeout(() => {
  if (document.getElementById('invictus-diag')) return;
  const barra = document.createElement('div');
  barra.style.cssText =
    'position:fixed;left:8px;right:8px;bottom:8px;z-index:99998;background:#1c1c1c;border:1px solid #444;' +
    'border-radius:10px;padding:10px 12px;color:#eee;font-family:-apple-system,sans-serif;font-size:12px;' +
    'display:flex;gap:8px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,.4)';
  const msg = document.createElement('div');
  msg.textContent = 'Diagnostico do carregamento disponivel.';
  msg.style.cssText = 'flex:1;line-height:1.35';
  const ver = document.createElement('button');
  ver.textContent = 'Ver';
  ver.style.cssText = 'padding:6px 12px;font-size:12px;font-weight:700;border:0;border-radius:6px;background:#EAB308;color:#000';
  ver.onclick = () => { barra.remove(); mostrarPainelDiagnostico(); };
  const x = document.createElement('button');
  x.textContent = 'Fechar';
  x.style.cssText = 'padding:6px 10px;font-size:12px;border:0;border-radius:6px;background:#333;color:#eee';
  x.onclick = () => barra.remove();
  barra.appendChild(msg); barra.appendChild(ver); barra.appendChild(x);
  document.body.appendChild(barra);
}, 20000);

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