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
echo "==> Ingestao de HealthKit/Health Connect (#248)"
# Roda o SecurityPipeline de verdade (10 sub-motores) contra o
# wearable-sync-service real. So dois modulos viram stub, pelo mesmo motivo
# de sempre -- evitar reconstruir um Firestore inteiro pra uma engrenagem que
# ja tem suite propria (igaService: ver regras-competitivas-iga.mjs acima) ou
# que so emite telemetria opcional (observability, so ativa quando ha traceId,
# nunca passado por aqui).
mkdir -p "$TRABALHO/wearable/lib"
cp -r "$RAIZ/api/_lib/." "$TRABALHO/wearable/lib/"
cat > "$TRABALHO/wearable/lib/common.ts" <<'STUB'
export let db: any = null;
export function __setDb(d: any) { db = d; }
export const FieldValue = { serverTimestamp: () => new Date().toISOString(), increment: (n: number) => ({ __increment: n }) };
export const FieldPath = { documentId: () => '__name__' };
export async function verifyAuth(_req: any) { return null; }
export function cors(_req: any, _res: any) { return false; }
STUB
cat > "$TRABALHO/wearable/lib/igaService.ts" <<'STUB'
let chamadas = 0;
export function __getRecalcCalls() { return chamadas; }
export function __resetRecalcCalls() { chamadas = 0; }
export async function recalculateAllUserScores(_userId: string) { chamadas++; return null; }
STUB
cat > "$TRABALHO/wearable/lib/observability.ts" <<'STUB'
export type PipelineTraceIds = { traceId?: string; correlationId?: string };
export async function recordPipelineStage(..._args: any[]) { return null; }
STUB
cat > "$TRABALHO/wearable/entry.ts" <<'ENTRY'
export { processarLoteWearable } from './lib/wearable-sync-service.js';
export { __setDb } from './lib/common.js';
export { __getRecalcCalls, __resetRecalcCalls } from './lib/igaService.js';
ENTRY
npx --yes esbuild "$TRABALHO/wearable/entry.ts" \
  --bundle --platform=node --format=esm \
  --outfile="$TRABALHO/wearable.mjs" --log-level=error
node "$RAIZ/tests/ingestao-wearable.mjs" "$TRABALHO/wearable.mjs"

echo
echo "Verificacao concluida."
