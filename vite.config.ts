import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
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