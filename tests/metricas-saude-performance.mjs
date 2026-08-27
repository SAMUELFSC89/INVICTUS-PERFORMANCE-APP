/**
 * Verificacao executavel das metricas de saude implementadas em #45
 * (VO2 max estimado e Indice de Consistencia -- performanceEngine.ts).
 *
 * Roda o motor real (processUserPerformance), nao uma reimplementacao.
 * Carga de treino (acute_chronic_workload_ratio) continua deliberadamente
 * indisponivel -- ver comentario em performanceEngine.ts -- e nao e testada
 * aqui por nao ter sido implementada.
 *
 * Como rodar:
 *   npx esbuild src/core/performance/performanceEngine.ts --bundle \
 *     --platform=node --format=esm --packages=external \
 *     --outfile=/tmp/perfengine.mjs
 *   node tests/metricas-saude-performance.mjs /tmp/perfengine.mjs
 */

const caminhoBundle = process.argv[2] || '/tmp/perfengine.mjs';
const { processUserPerformance } = await import(caminhoBundle);

let falhas = 0;
const conferir = (nome, condicao, detalhe) => {
  if (!condicao) falhas++;
  console.log(`${condicao ? 'OK  ' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
};

const now = Date.now();
const DIA = 24 * 60 * 60 * 1000;

// CENARIO 1: corrida real de 5km/30min, FC media 150, FC Max cadastrada 190.
// VO2sub (formula corrida ACSM) = 3.5 + 0.2*166.67 = 36.83
// VO2max = 36.83 * (190/150) = 46.65
{
  const workouts = [{ id: 'w1', userId: 'u1', timestamp: now - 2 * DIA, durationMinutes: 30, distanceKm: 5, avgHeartRate: 150, validationStatus: 'valid' }];
  const state = processUserPerformance(workouts, { uid: 'u1', maxHeartRate: 190 }, '30days');
  const vo2 = state.computedMetrics.vo2max_estimate;
  conferir('VO2max: corrida real com FC+FCMax -> estimado', vo2.hasEnoughData && Math.abs(Number(vo2.currentValue) - 46.65) < 0.5, `valor=${vo2.currentValue}`);
}

// CENARIO 2: sem FC Maxima cadastrada no perfil -> NUNCA estima com 220-idade
// ou qualquer valor inventado. Fica indisponivel.
{
  const workouts = [{ id: 'w1', userId: 'u3', timestamp: now - 2 * DIA, durationMinutes: 30, distanceKm: 5, avgHeartRate: 150, validationStatus: 'valid' }];
  const state = processUserPerformance(workouts, { uid: 'u3' }, '30days');
  conferir('VO2max: sem FC Máxima cadastrada -> indisponível (fail-closed)', state.computedMetrics.vo2max_estimate.hasEnoughData === false);
}

// CENARIO 3: ritmo implausivel para corrida/caminhada (ex.: dado de bike
// classificado incorretamente, 35km/h) -> nao deve estimar.
{
  const workouts = [{ id: 'w1', userId: 'u5', timestamp: now - 2 * DIA, durationMinutes: 30, distanceKm: 17.5, avgHeartRate: 150, validationStatus: 'valid' }];
  const state = processUserPerformance(workouts, { uid: 'u5', maxHeartRate: 190 }, '30days');
  conferir('VO2max: ritmo implausível (35km/h) -> não estima', state.computedMetrics.vo2max_estimate.hasEnoughData === false);
}

// CENARIO 4: 6 dias distintos ativos numa janela de 30 dias.
// meta = (30/7)*5 = 21.43 -> consistencia = round(6/21.43*100) = 28%
{
  const workouts = Array.from({ length: 6 }, (_, i) => ({
    id: 'c' + i, userId: 'u2', timestamp: now - (i * 3) * DIA, durationMinutes: 40, validationStatus: 'valid'
  }));
  const state = processUserPerformance(workouts, { uid: 'u2' }, '30days');
  const cons = state.computedMetrics.consistency_index;
  conferir('Consistência: 6 dias ativos em 30 dias -> ~28%', cons.hasEnoughData && cons.currentValue === 28, `valor=${cons.currentValue}`);
}

// CENARIO 5: periodo selecionado curto demais (today) -> indisponivel, mesmo
// com treinos no historico.
{
  const workouts = Array.from({ length: 6 }, (_, i) => ({
    id: 'c' + i, userId: 'u4', timestamp: now - (i * 3) * DIA, durationMinutes: 40, validationStatus: 'valid'
  }));
  const state = processUserPerformance(workouts, { uid: 'u4' }, 'today');
  conferir('Consistência: período "today" -> indisponível (janela curta demais)', state.computedMetrics.consistency_index.hasEnoughData === false);
}

// CENARIO 6: consistencia perfeita (5+ dias/semana) fica travada em 100%, nunca
// passa disso.
{
  const workouts = Array.from({ length: 30 }, (_, i) => ({
    id: 'c' + i, userId: 'u6', timestamp: now - i * DIA, durationMinutes: 40, validationStatus: 'valid'
  }));
  const state = processUserPerformance(workouts, { uid: 'u6' }, '30days');
  conferir('Consistência: treino todo dia -> capada em 100%', state.computedMetrics.consistency_index.currentValue === 100);
}

console.log(`\n${falhas === 0 ? 'Métricas de saúde (#45): todos os cenários passaram.' : falhas + ' cenário(s) falharam.'}`);
process.exit(falhas === 0 ? 0 : 1);
