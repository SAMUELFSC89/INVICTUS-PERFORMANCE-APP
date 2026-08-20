import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        // #223 - ESTE PLUGIN E O QUE FAZ O APP iOS ABRIR.
        //
        // Por padrao o Vite emite <script type="module" crossorigin ...> e
        // links de modulepreload tambem com crossorigin. No navegador isso e
        // inofensivo (mesma origem https). No app nativo NAO:
        //
        // o WebView do iOS serve os arquivos pelo esquema capacitor://localhost,
        // que o WebKit trata como origem opaca. Com o atributo crossorigin o
        // WebView faz uma requisicao CORS que esse esquema nao consegue
        // satisfazer -- o script falha ao carregar e o evento de erro chega
        // sanitizado como "Script error." sem arquivo, sem linha e sem stack.
        // Era exatamente essa a tela de erro que aparecia no iPhone.
        //
        // Sem o atributo, vira uma requisicao normal de mesma origem.
        name: "remover-crossorigin-para-capacitor",
        enforce: "post",
        transformIndexHtml(html: string) {
          return html.replace(/\s+crossorigin(=["'][^"']*["'])?/g, "");
        }
      }
    ],
    build: {
      // Desliga o modulepreload: os <link rel="modulepreload"> gerados pelo
      // Vite tambem carregam com crossorigin em runtime (via __vitePreload) e
      // sofrem do mesmo problema acima no esquema capacitor://.
      modulePreload: false,
    },
    define: {
      // #224: a GEMINI_API_KEY foi REMOVIDA do bundle do cliente.
      //
      // Antes havia aqui:
      //     'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      //
      // Esse define injetava a chave real em texto claro dentro do JS publico
      // do site. Qualquer pessoa conseguia abrir o codigo-fonte e extrair.
      // A validacao por IA passou a rodar no servidor
      // (api/_handlers/validate-activity.ts), onde process.env.GEMINI_API_KEY
      // e uma variavel de ambiente de verdade e nunca chega ao navegador.
      //
      // NAO reintroduza nenhum define de segredo aqui.
      'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});