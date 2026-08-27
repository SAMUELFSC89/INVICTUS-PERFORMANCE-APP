/**
 * Verificacao executavel da deduplicacao entre fontes (#240).
 *
 * Roda a funcao de verdade contra um Firestore falso em memoria. O objetivo
 * nao e so provar que a duplicata e detectada: metade dos casos abaixo existe
 * para provar que treinos legitimos NAO sao acusados por engano -- um falso
 * positivo aqui apaga um treino real do ranking de alguem.
 *
 * Como rodar: veja scripts/verificar-antifraude.sh
 *   node tests/deduplicacao-entre-fontes.mjs <caminho-do-bundle.mjs>
 */

const caminhoBundle = process.argv[2] || '/tmp/dedup/b2.mjs';
const { encontrarAtividadeDuplicada, __setDb } = await import(caminhoBundle);

const base = new Date('2026-08-26T07:00:00Z');
const bancoFalso = (documentos) => ({
  collection: () => ({ where: () => ({ get: async () => ({ docs: documentos.map((d, i) => ({ id: 'w' + i, data: () => d })) }) }) })
});

let falhas = 0;
const conferir = (nome, condicao, detalhe) => {
  if (!condicao) falhas++;
  console.log(`${condicao ? 'OK  ' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
};

const corridaInvictus = { userId: 'u', source: 'invictus', type: 'cardio', timestamp: base.toISOString(), duration: 32, distance: 5.1 };

// DEVE detectar: mesma corrida gravada pelo app e sincronizada pelo Strava.
__setDb(bancoFalso([corridaInvictus]));
let r = await encontrarAtividadeDuplicada('u', { inicio: new Date(base.getTime() + 5 * 60000), duracaoMin: 31, distanciaKm: 5.0, tipo: 'run', fonte: 'strava', sourceActivityId: '123' });
conferir('Mesma corrida por Invictus + Strava e detectada', r?.motivo === 'MESMA_JANELA_E_METRICAS', r?.motivo || 'nao detectou');

// NAO PODE detectar: duas corridas reais no mesmo dia, horarios distantes.
__setDb(bancoFalso([corridaInvictus]));
r = await encontrarAtividadeDuplicada('u', { inicio: new Date(base.getTime() + 6 * 3600 * 1000), duracaoMin: 31, distanciaKm: 5.0, tipo: 'run', fonte: 'strava', sourceActivityId: '124' });
conferir('Corrida 6h depois NAO e duplicata', r === null, r ? 'falso positivo' : 'ok');

// NAO PODE detectar: mesma janela, mas 5 km x 12 km sao sessoes diferentes.
__setDb(bancoFalso([corridaInvictus]));
r = await encontrarAtividadeDuplicada('u', { inicio: base, duracaoMin: 70, distanciaKm: 12, tipo: 'run', fonte: 'strava', sourceActivityId: '125' });
conferir('Metricas incompativeis NAO viram duplicata', r === null, r ? 'falso positivo' : 'ok');

// NAO PODE detectar: musculacao e corrida na mesma janela sao modalidades diferentes.
__setDb(bancoFalso([{ userId: 'u', source: 'invictus', type: 'workout', timestamp: base.toISOString(), duration: 60 }]));
r = await encontrarAtividadeDuplicada('u', { inicio: base, duracaoMin: 60, tipo: 'run', fonte: 'strava', sourceActivityId: '126' });
conferir('Musculacao x corrida na mesma janela NAO e duplicata', r === null, r ? 'falso positivo' : 'ok');

// DEVE detectar: re-sync da mesma atividade do Strava (idempotencia por origem).
__setDb(bancoFalso([{ userId: 'u', source: 'strava', sourceActivityId: '999', type: 'cardio', timestamp: base.toISOString(), duration: 30, distance: 5 }]));
r = await encontrarAtividadeDuplicada('u', { inicio: base, duracaoMin: 30, distanciaKm: 5, tipo: 'run', fonte: 'strava', sourceActivityId: '999' });
conferir('Re-sync do mesmo id do Strava e duplicata exata', r?.motivo === 'MESMO_ID_DE_ORIGEM', r?.motivo || 'nao detectou');

// DEVE detectar: musculacao sem distancia -- a duracao decide sozinha.
__setDb(bancoFalso([{ userId: 'u', source: 'invictus', type: 'workout', timestamp: base.toISOString(), duration: 60 }]));
r = await encontrarAtividadeDuplicada('u', { inicio: new Date(base.getTime() + 10 * 60000), duracaoMin: 58, tipo: 'workout', fonte: 'apple_health', sourceActivityId: 'hk1' });
conferir('Musculacao repetida por outra fonte e duplicata', r?.motivo === 'MESMA_JANELA_E_METRICAS', r?.motivo || 'nao detectou');

console.log(`\n${falhas === 0 ? 'Deduplicacao: todos os cenarios passaram.' : falhas + ' cenario(s) falharam.'}`);
process.exit(falhas === 0 ? 0 : 1);
