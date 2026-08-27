/**
 * Verificacao executavel das regras competitivas do IGA.
 *
 * Nao e um teste de compilacao: ele RODA o motor e confere o resultado.
 * Cobre as regras de produto definidas para musculacao/cardio (#239) e a
 * garantia de que atividade reprovada pelo antifraude nao pontua.
 *
 * Como rodar (nao depende de node_modules instalado):
 *   npx esbuild src/core/iga/index.ts --bundle --platform=node --format=esm --outfile=/tmp/iga.mjs
 *   node tests/regras-competitivas-iga.mjs /tmp/iga.mjs
 */

const caminhoMotor = process.argv[2] || '/tmp/iga.mjs';
const { calculateWeeklyIGA } = await import(caminhoMotor);

const perfil = { age: 30, weightKg: 80 };
const sessao = (min, tipo = 'workout', hr = 140, kcal = 0, valida = true) => ({
  type: tipo, durationMinutes: min, avgHeartRate: hr, caloriesInformed: kcal, isValid: valida
});

let falhas = 0;
function conferir(descricao, condicao, detalhe) {
  const ok = Boolean(condicao);
  if (!ok) falhas++;
  console.log(`${ok ? 'OK  ' : 'FALHOU'}  ${descricao}${detalhe ? '  -- ' + detalhe : ''}`);
}

// 1. Minimo competitivo por modalidade (musculacao 30 min, cardio 20 min).
//    Abaixo do minimo a sessao NAO e fraude: ela so nao alimenta a competicao.
const m25 = calculateWeeklyIGA([sessao(25)], perfil);
const m30 = calculateWeeklyIGA([sessao(30)], perfil);
conferir('Musculacao de 25 min nao conta (minimo 30)', m25.frequency === 0, `F=${m25.frequency}`);
conferir('Musculacao de 30 min conta', m30.frequency === 1, `F=${m30.frequency}`);

const c15 = calculateWeeklyIGA([sessao(15, 'cardio')], perfil);
const c20 = calculateWeeklyIGA([sessao(20, 'cardio')], perfil);
conferir('Cardio de 15 min nao conta (minimo 20)', c15.frequency === 0, `F=${c15.frequency}`);
conferir('Cardio de 20 min conta', c20.frequency === 1, `F=${c20.frequency}`);

// 2. Teto de 90 min contabilizados por sessao. Inflar a duracao nao pode ser
//    um atalho para o topo do ranking.
const t90 = calculateWeeklyIGA([sessao(90)], perfil);
const t300 = calculateWeeklyIGA([sessao(300)], perfil);
conferir('Sessao de 300 min pontua igual a uma de 90 min', t90.igaRanking === t300.igaRanking, `90min=${t90.igaRanking} 300min=${t300.igaRanking}`);
conferir('Tempo contabilizado limitado a 90 min', t300.totalTimeMinutes === 90, `T=${t300.totalTimeMinutes}`);

// 3. Consistencia tem que valer mais do que uma sessao inflada.
const consistente = calculateWeeklyIGA([sessao(50), sessao(50), sessao(50), sessao(50), sessao(50)], perfil);
const inflado = calculateWeeklyIGA([sessao(500)], perfil);
conferir('5 treinos reais valem mais que 1 sessao inflada', consistente.igaRanking > inflado.igaRanking, `${consistente.igaRanking} > ${inflado.igaRanking}`);

// 4. Sessao reprovada pelo antifraude nao entra no IGA.
const comReprovada = calculateWeeklyIGA([sessao(60), sessao(60), sessao(60, 'workout', 140, 0, false)], perfil);
conferir('Sessao reprovada nao entra na frequencia', comReprovada.frequency === 2, `F=${comReprovada.frequency}`);

// 5. O teto de tempo nao pode criar falsa suspeita de caloria inflada numa
//    sessao longa e honesta (a plausibilidade usa a duracao real).
const longaHonesta = calculateWeeklyIGA([sessao(120, 'workout', 140, 900)], perfil);
conferir('120 min / 900 kcal nao e penalizado', longaHonesta.overallGate === 1, `gate=${longaHonesta.overallGate}`);

// 6. Caloria fisiologicamente incompativel continua sendo penalizada.
const absurda = calculateWeeklyIGA([sessao(60, 'workout', 140, 3000)], perfil);
conferir('60 min / 3000 kcal e penalizado', absurda.overallGate < 1, `gate=${absurda.overallGate}`);

console.log(`\n${falhas === 0 ? 'Todas as regras competitivas passaram.' : falhas + ' regra(s) falharam.'}`);
process.exit(falhas === 0 ? 0 : 1);
