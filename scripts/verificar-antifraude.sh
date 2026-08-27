#!/usr/bin/env bash
# Verificacao executavel das regras competitivas e da deduplicacao.
#
# Nao exige `npm install`: usa apenas npx esbuild + node. A intencao e poder
# rodar isso rapidamente antes de um deploy, sem depender do ambiente completo.
#
# Uso:  bash scripts/verificar-antifraude.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRABALHO="$(mktemp -d)"
trap 'rm -rf "$TRABALHO"' EXIT

echo "==> Regras competitivas do IGA"
npx --yes esbuild "$RAIZ/src/core/iga/index.ts" \
  --bundle --platform=node --format=esm \
  --outfile="$TRABALHO/iga.mjs" --log-level=error
node "$RAIZ/tests/regras-competitivas-iga.mjs" "$TRABALHO/iga.mjs"

echo
echo "==> Deduplicacao entre fontes"
# `db` e um singleton importado de _lib/common.js (Firebase Admin). Para testar
# a logica pura, trocamos esse modulo por um stub que permite injetar um banco
# falso -- sem tocar no arquivo real.
cat > "$TRABALHO/common.ts" <<'STUB'
export let db: any = null;
export function __setDb(d: any) { db = d; }
STUB
cp "$RAIZ/api/_lib/modality-config.ts" "$TRABALHO/modality-config.ts"
sed 's#\./common\.js#./common.ts#; s#\./modality-config\.js#./modality-config.ts#' \
  "$RAIZ/api/_lib/activity-dedup.ts" > "$TRABALHO/activity-dedup.ts"
cat > "$TRABALHO/entry.ts" <<'ENTRY'
export { encontrarAtividadeDuplicada } from './activity-dedup.ts';
export { __setDb } from './common.ts';
ENTRY
npx --yes esbuild "$TRABALHO/entry.ts" \
  --bundle --platform=node --format=esm \
  --outfile="$TRABALHO/dedup.mjs" --log-level=error
node "$RAIZ/tests/deduplicacao-entre-fontes.mjs" "$TRABALHO/dedup.mjs"

echo
echo "==> Pesos de integridade por modalidade (#247)"
npx --yes esbuild "$RAIZ/api/_lib/integrity-engine.ts" \
  --bundle --platform=node --format=esm \
  --outfile="$TRABALHO/integrity.mjs" --log-level=error
node "$RAIZ/tests/pesos-por-modalidade-integridade.mjs" "$TRABALHO/integrity.mjs"

echo
echo "Verificacao concluida."
