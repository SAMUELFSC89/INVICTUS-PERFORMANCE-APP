#!/usr/bin/env node
/** Run with: node --import tsx scripts/export-exercise-catalog.mjs [--check] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OFFICIAL_EXERCISES_BATCH_01 as exercises,
  OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS as requirements,
  OFFICIAL_MUSCLE_GROUP_LABELS as groupLabels,
} from '../src/data/exerciseCatalog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'design/exercise-library/rebuild-2026-09-05');
const check = process.argv.includes('--check');
const legacy = JSON.parse(fs.readFileSync(path.join(destination, 'legacy-catalog-snapshot.json'), 'utf8'));
const legacyIds = new Set(legacy.exercises.map(exercise => exercise.id));
const sourceCommit = legacy.sourceCommit;
const expectedCounts = { peito: 8, costas: 10, pernas: 17, ombros: 7, bracos: 10, core: 7 };
const knownEquipment = new Set(['barra_anilhas', 'halteres', 'maquinas', 'kettlebell', 'barra_fixa', 'elasticos', 'banco', 'crossover']);
const ids = new Set();
for (const exercise of exercises) {
  if (ids.has(exercise.id)) throw new Error(`Duplicate exercise ID: ${exercise.id}`);
  ids.add(exercise.id);
  if (!Array.isArray(requirements[exercise.id])) throw new Error(`Missing requirements: ${exercise.id}`);
  if (requirements[exercise.id].some(equipment => !knownEquipment.has(equipment))) throw new Error(`Unknown equipment: ${exercise.id}`);
  if (!/^\/assets\/exercise-library\/rebuild-2026-09-05\/[a-z0-9_]+\/thumb\.webp$/.test(exercise.thumbUrl)) throw new Error(`Unexpected image path: ${exercise.id}`);
  if (exercise.thumbUrl.split('/').at(-2) !== exercise.id) throw new Error(`Image path does not match ID: ${exercise.id}`);
  if (exercise.thumbStatus === 'ready') {
    const localPath = path.join(root, 'public', exercise.thumbUrl);
    if (!fs.existsSync(localPath) || fs.statSync(localPath).size === 0) throw new Error(`Ready image absent: ${exercise.id}`);
  }
  if (exercise.demoStatus === 'ready' || exercise.demoUrl) throw new Error(`No videos were produced in this package: ${exercise.id}`);
}
if (ids.size !== 59) throw new Error(`Expected 59 exercises; got ${ids.size}`);
for (const [group, count] of Object.entries(expectedCounts)) {
  if (exercises.filter(exercise => exercise.muscleGroup === group).length !== count) throw new Error(`Unexpected count in ${group}`);
}
for (const old of legacy.exercises) {
  const current = exercises.find(exercise => exercise.id === old.id);
  for (const key of ['id', 'name', 'muscleGroup', 'equipment']) {
    if (current?.[key] !== old[key]) throw new Error(`Legacy field changed: ${old.id}.${key}`);
  }
}
if (legacyIds.size !== 27) throw new Error('Expected 27 legacy IDs');

const catalog = {
  schemaVersion: 1,
  sourceCommit,
  version: 'rebuild-2026-09-05',
  background: 'black',
  counts: { total: exercises.length, legacy: legacyIds.size, added: exercises.length - legacyIds.size, thumbnailsReady: exercises.filter(exercise => exercise.thumbStatus === 'ready').length, demosReady: 0, groups: expectedCounts },
  equipmentSemantics: 'All listed categories are required. maquinas/crossover are broad questionnaire categories; they do not verify a complete gym inventory.',
  exercises: exercises.map(exercise => ({
    ...exercise,
    origin: legacyIds.has(exercise.id) ? 'legacy_preserved' : 'added',
    equipmentRequirements: requirements[exercise.id],
    // No aliases are invented. Existing saved IDs already are canonical IDs.
    aliases: [],
  })),
};
const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const headers = ['id', 'nome', 'grupo', 'subgrupo', 'equipamento_descricao', 'equipamento_categorias', 'origem', 'imagem_estado', 'imagem_url', 'imagem_alternativa', 'video_estado', 'video_url'];
const csv = '\uFEFF' + [headers, ...catalog.exercises.map(exercise => [
  exercise.id, exercise.name, groupLabels[exercise.muscleGroup], exercise.muscleSubgroup || '', exercise.equipment,
  exercise.equipmentRequirements.join(' + '), exercise.origin, exercise.thumbStatus, exercise.thumbUrl, exercise.thumbFallbackUrl || '', exercise.demoStatus, exercise.demoUrl || '',
])].map(row => row.map(quote).join(';')).join('\n') + '\n';
const markdown = [
  '# Catálogo de exercícios INVICTUS', '',
  `Base verificada: \`${sourceCommit}\`. Fonte única: \`src/data/exerciseCatalog.ts\`.`, '',
  `**59 IDs únicos: 27 legados preservados e 32 adicionados. ${catalog.counts.thumbnailsReady} imagens vinculadas; vídeos de execução continuam pendentes.**`, '',
  'Os IDs e os nomes dos 27 exercícios anteriores permanecem iguais aos do repositório. Os arquivos originais em `v1` devem ser preservados. As imagens desta reconstrução usam uma pasta versionada própria, com fundo preto autorizado pelo usuário.', '',
  'O ID histórico `barbell_stiff_deadlift` mantém o nome “Stiff / Romanian Deadlift” e o equipamento **halteres**. Não converter para barra nem renomear o ID ao importar. Não há aliases inventados ou migração de IDs.', '',
  '| Grupo | Exercícios |', '|---|---:|',
  ...Object.entries(expectedCounts).map(([group, count]) => `| ${groupLabels[group]} | ${count} |`), '',
];
for (const group of Object.keys(expectedCounts)) {
  markdown.push(`## ${groupLabels[group]}`, '', '| ID | Nome | Equipamento | Origem |', '|---|---|---|---|');
  for (const exercise of catalog.exercises.filter(item => item.muscleGroup === group)) markdown.push(`| \`${exercise.id}\` | ${exercise.name} | ${exercise.equipment} | ${exercise.origin === 'legacy_preserved' ? 'Legado' : 'Novo'} |`);
  markdown.push('');
}
markdown.push('## Equipamentos e demonstrações', '',
  'Os requisitos compartilhados usam as categorias já existentes no questionário. Todos os itens de cada exercício são necessários. “Aparelhos de musculação” e “Crossover” continuam categorias amplas: a seleção não confirma que a academia possui cada máquina, regulagem ou acessório descrito. Essa limitação precisa ser considerada antes de ampliar a automação de planos.', '',
  'Nenhum vídeo foi gerado: `demoStatus` permanece `waiting_for_demo`, sem URL inventada. As imagens são referências estáticas; não certificam toda a execução. Qualquer ressalva visual está registrada no relatório de mídia do pacote.', '',
  'Exporte novamente após atualizar estados ou caminhos: `node --import tsx scripts/export-exercise-catalog.mjs`. Confira consistência com `--check`.', '');
const files = new Map([
  ['exercise-catalog.json', JSON.stringify(catalog, null, 2) + '\n'],
  ['CATALOGO_59_EXERCICIOS.csv', csv],
  ['CATALOGO_59_EXERCICIOS.md', markdown.join('\n')],
  ['legacy-id-map.json', JSON.stringify({ sourceCommit, note: 'Identity map. No ID migration is necessary.', ids: Object.fromEntries([...legacyIds].map(id => [id, id])) }, null, 2) + '\n'],
]);
for (const [name, contents] of files) {
  const filename = path.join(destination, name);
  if (check) {
    if (!fs.existsSync(filename) || fs.readFileSync(filename, 'utf8') !== contents) throw new Error(`Stale export: ${name}; run exporter without --check`);
  } else fs.writeFileSync(filename, contents);
}
console.log(`Catalogue ${check ? 'verified' : 'exported'}: 59 IDs / 27 legacy / 32 added / ${catalog.counts.thumbnailsReady} ready images / 0 ready videos.`);
