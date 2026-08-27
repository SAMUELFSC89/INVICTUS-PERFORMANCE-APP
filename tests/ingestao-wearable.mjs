/**
 * Verificacao executavel da ingestao de HealthKit/Health Connect (#248).
 *
 * Roda o wearable-sync-service DE VERDADE, junto com o SecurityPipeline real
 * (10 sub-motores) e a deduplicacao real -- nao uma reimplementacao. So dois
 * pontos sao trocados por dublês, os dois pelo mesmo motivo (evitar precisar
 * reconstruir um Firestore inteiro em memoria pra uma engrenagem que já tem
 * suite própria):
 *   - common.js: Firestore em memoria, controlavel via __setDb.
 *   - igaService.js: recalculateAllUserScores vira um contador -- o calculo
 *     do IGA em si já é coberto por tests/regras-competitivas-iga.mjs.
 *
 * Como rodar: veja scripts/verificar-antifraude.sh
 *   node tests/ingestao-wearable.mjs <caminho-do-bundle.mjs>
 */

const caminhoBundle = process.argv[2] || '/tmp/ingestao-wearable-bundle.mjs';
const { processarLoteWearable, __setDb, __getRecalcCalls, __resetRecalcCalls } = await import(caminhoBundle);

let falhas = 0;
const conferir = (nome, condicao, detalhe) => {
  if (!condicao) falhas++;
  console.log(`${condicao ? 'OK  ' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
};

// Firestore em memoria minimo: cobre collection().doc().get()/.set() e
// collection().where().get() (usado por buscarHistoricoRecente e pela
// deduplicacao), alem de collection().doc().set() do audit-logger.
function criarBancoFalso() {
  const colecoes = new Map();
  const colecao = (nome) => {
    if (!colecoes.has(nome)) colecoes.set(nome, new Map());
    return colecoes.get(nome);
  };
  const snapshotDe = (docsMap) => {
    const docs = [...docsMap.entries()].map(([id, data]) => ({ id, data: () => data, exists: true }));
    return { docs, forEach: (fn) => docs.forEach(fn) };
  };
  return {
    collection: (nome) => ({
      doc: (id) => ({
        get: async () => {
          const data = colecao(nome).get(id);
          return { exists: data !== undefined, data: () => data, id };
        },
        set: async (data, opts) => {
          const atual = colecao(nome).get(id) || {};
          colecao(nome).set(id, opts?.merge ? { ...atual, ...data } : data);
        }
      }),
      where: () => ({
        // Sem filtro real: os cenarios abaixo usam um userId por banco falso,
        // entao "todos os docs da colecao" já equivale a "docs do usuario".
        get: async () => snapshotDe(colecao(nome))
      }),
      add: async (data) => {
        const id = 'auto_' + Math.random().toString(36).slice(2);
        colecao(nome).set(id, data);
        return { id };
      }
    }),
    _dump: (nome) => Object.fromEntries(colecao(nome))
  };
}

const base = new Date('2026-08-27T10:00:00Z');

// CENARIO 1: musculacao sem GPS nenhum -- tem que aprovar (perfil STRENGTH
// nao exige deslocamento) e nao pode aparecer como "sem GPS" bloqueando.
{
  const banco1 = criarBancoFalso();
  __setDb(banco1);
  __resetRecalcCalls();
  const r = await processarLoteWearable('user1', [{
    source: 'apple_health', sourceActivityId: 'w1', activityType: 'Musculação',
    startTime: base.toISOString(), durationSeconds: 40 * 60, calories: 300, averageHeartRate: 120
  }]);
  conferir('Musculação sem GPS: aprovada', r.syncedCount === 1, JSON.stringify(r.resultados));
  conferir('Musculação: recalculateAllUserScores chamado 1x por lote', __getRecalcCalls() === 1);

  // #251: Health Data Layer -- amostras reais devem ser gravadas ALEM do
  // registro em `workouts`, com quality 'sensor_verified' (foi aprovada).
  const amostras1 = Object.values(banco1._dump('health_samples'));
  conferir('Health Layer: gravou heart_rate_avg=120 bpm', amostras1.some(a => a.metricType === 'heart_rate_avg' && a.value === 120 && a.unit === 'bpm'));
  conferir('Health Layer: gravou calories_active=300 kcal', amostras1.some(a => a.metricType === 'calories_active' && a.value === 300));
  conferir('Health Layer: gravou duration_min=40', amostras1.some(a => a.metricType === 'duration_min' && a.value === 40));
  conferir('Health Layer: NAO inventou distance_km (musculação não tem)', !amostras1.some(a => a.metricType === 'distance_km'));
  conferir('Health Layer: NAO inventou heart_rate_max (não veio no payload)', !amostras1.some(a => a.metricType === 'heart_rate_max'));
  conferir('Health Layer: quality=sensor_verified (atividade aprovada)', amostras1.every(a => a.quality === 'sensor_verified'));
}

// CENARIO 2: corrida com rota GPS real (checkpoints) -- deve aprovar.
{
  __setDb(criarBancoFalso());
  const checkpoints = Array.from({ length: 10 }, (_, i) => ({ latitude: -23.5 + i * 0.001, longitude: -46.6 + i * 0.001 }));
  const r = await processarLoteWearable('user2', [{
    source: 'health_connect', sourceActivityId: 'r1', activityType: 'Corrida',
    startTime: base.toISOString(), durationSeconds: 30 * 60, distanceMeters: 5000,
    averageHeartRate: 150, maxHeartRate: 170, checkpoints
  }]);
  conferir('Corrida com rota GPS: aprovada', r.syncedCount === 1, JSON.stringify(r.resultados));
}

// CENARIO 3: corrida SEM rota GPS -- não pode ser tratada como se tivesse
// deslocamento confirmado. Aceitável que fique bloqueada/em revisão (fail-closed);
// o que não pode acontecer é aprovar sem evidência nenhuma de movimento.
{
  const banco3 = criarBancoFalso();
  __setDb(banco3);
  const r = await processarLoteWearable('user3', [{
    source: 'apple_health', sourceActivityId: 'r2', activityType: 'Corrida',
    startTime: base.toISOString(), durationSeconds: 25 * 60, distanceMeters: 4000
  }]);
  conferir('Corrida sem rota GPS: não aprova cegamente', r.syncedCount === 0, JSON.stringify(r.resultados));

  // #251: bloqueio COMPETITIVO (antifraude) não pode apagar a leitura de
  // saúde real -- ela deve existir, só marcada como 'sensor_flagged' em vez
  // de 'sensor_verified', para uso cauteloso em tendências (não em ranking).
  const amostras3 = Object.values(banco3._dump('health_samples'));
  conferir('Health Layer: mesmo bloqueada no IGA, grava a distância real', amostras3.some(a => a.metricType === 'distance_km' && a.value === 4));
  conferir('Health Layer: quality=sensor_flagged (bloqueada pelo antifraude, não duplicata)', amostras3.every(a => a.quality === 'sensor_flagged'));
}

// CENARIO 4: duplicata DENTRO do mesmo lote (mesma corrida entregue duas vezes
// pela mesma fonte, ex.: reprocessamento) -- a segunda tem que ser pega porque
// o processamento é sequencial (a primeira já está no Firestore falso quando
// a segunda é avaliada).
{
  const banco4 = criarBancoFalso();
  __setDb(banco4);
  const checkpoints = Array.from({ length: 5 }, (_, i) => ({ latitude: -23.5 + i * 0.001, longitude: -46.6 + i * 0.001 }));
  const r = await processarLoteWearable('user4', [
    { source: 'apple_health', sourceActivityId: 'dup1', activityType: 'Corrida', startTime: base.toISOString(), durationSeconds: 20 * 60, distanceMeters: 3000, checkpoints },
    { source: 'apple_health', sourceActivityId: 'dup1', activityType: 'Corrida', startTime: base.toISOString(), durationSeconds: 20 * 60, distanceMeters: 3000, checkpoints }
  ]);
  conferir('Reprocessar o mesmo id do mesmo lote: 1 aprovada + 1 duplicata', r.syncedCount === 1 && r.duplicatesSkipped === 1, JSON.stringify(r.resultados));

  // #251: a segunda entrega (duplicata) não pode inflar a série temporal de
  // saúde -- mesmo evento real, uma leitura só. distance_km deve aparecer
  // uma única vez (a chave do doc já garante isso, mas confirmamos a
  // contagem para pegar qualquer regressão que remova o guard de duplicata).
  const amostras4 = Object.values(banco4._dump('health_samples'));
  conferir('Health Layer: duplicata não duplica a amostra (1x distance_km)', amostras4.filter(a => a.metricType === 'distance_km').length === 1);
}

// CENARIO 5: lote vazio não deve chamar recalculo nem quebrar.
{
  __setDb(criarBancoFalso());
  __resetRecalcCalls();
  const r = await processarLoteWearable('user5', []);
  conferir('Lote vazio: 0/0/0 e sem recalculo', r.syncedCount === 0 && r.duplicatesSkipped === 0 && __getRecalcCalls() === 0);
}

console.log(`\n${falhas === 0 ? 'Ingestão wearable: todos os cenários passaram.' : falhas + ' cenário(s) falharam.'}`);
process.exit(falhas === 0 ? 0 : 1);
