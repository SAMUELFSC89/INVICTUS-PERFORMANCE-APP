# Hotfix: catálogo 250 no runtime ESM da Vercel

## Causa
Após a integração do catálogo de 250 exercícios, `src/data/exerciseCatalog.ts` e os novos módulos em `exerciseCatalogExpansion/` continham imports relativos de runtime sem extensão. O projeto usa `type: module` e Node 22; por isso a função serverless falhava durante a inicialização com `ERR_MODULE_NOT_FOUND`, começando por `exerciseCatalogLegacy`.

## Correção
- todos os imports relativos de runtime do catálogo/expansão usam `.js` explicitamente;
- a importação do diretório de expansão aponta para `./exerciseCatalogExpansion/index.js`;
- nenhuma definição de exercício, regra de compatibilidade, memória privada, RIR ou configuração Gemini foi alterada.

## Regressão
Foi adicionado `npm run test:catalog-esm`, executado no CI, que transpila e percorre o grafo runtime do catálogo e falha caso encontre import relativo sem extensão ESM explícita.

## Critério de liberação
Só promover após typecheck, regras Firebase, testes unitários, build, startup serverless ESM, validação ESM do catálogo e smoke test real de `/api/training-plans` no preview da Vercel.
