/**
 * Verificação executável das regras competitivas do IGA 2.0.
 *
 * Como rodar:
 *   npx esbuild src/core/iga/index.ts --bundle --platform=node --format=esm --outfile=/tmp/iga.mjs
 *   node tests/regras-competitivas-iga.mjs /tmp/iga.mjs
 */

const caminhoMotor = process.argv[2] || '/tmp/iga.mjs';
const { calculateWeeklyIGA, heartRateToIntensityFactor } = await import(caminhoMotor);

const perfil = { age: 30, weightKg: 80, maxHeartRate: 190 };
const sessao = (min, tipo = 'workout', hr = 143, kcal = 0, valida = true, extras = {}) => ({
  type: tipo,
  durationMinutes: min,
  avgHeartRate: hr,
  caloriesInformed: kcal,
  isValid: valida,
  ...extras,
});

let falhas = 0;
function conferir(descricao, condicao, detalhe) {
  const ok = Boolean(condicao);
  if (!ok) falhas++;
  console.log(`${ok ? 'OK  ' : 'FALHOU'}  ${descricao}${detalhe ? '  -- ' + detalhe : ''}`);
}

// 1. Mínimos competitivos permanecem por modalidade.
const m25 = calculateWeeklyIGA([sessao(25)], perfil);
const m30 = calculateWeeklyIGA([sessao(30)], perfil);
conferir('Musculação de 25 min não conta (mínimo 30)', m25.frequency === 0, `F=${m25.frequency}`);
conferir('Musculação de 30 min conta', m30.frequency === 1, `F=${m30.frequency}`);

const c15 = calculateWeeklyIGA([sessao(15, 'cardio')], perfil);
const c20 = calculateWeeklyIGA([sessao(20, 'cardio')], perfil);
conferir('Cardio de 15 min não conta (mínimo 20)', c15.frequency === 0, `F=${c15.frequency}`);
conferir('Cardio de 20 min conta', c20.frequency === 1, `F=${c20.frequency}`);

// 2. Curva de tempo: 60=100, 90=104 e acima de 90 não cresce.
const t60 = calculateWeeklyIGA([sessao(60)], perfil);
const t90 = calculateWeeklyIGA([sessao(90)], perfil);
const t300 = calculateWeeklyIGA([sessao(300)], perfil);
conferir('60 min usa T=100', t60.Tn === 1, `T=${t60.Tn}`);
conferir('90 min usa T=104', t90.Tn === 1.04, `T=${t90.Tn}`);
conferir('300 min pontua como 90 min', t90.igaRanking === t300.igaRanking, `90=${t90.igaRanking} 300=${t300.igaRanking}`);

// 3. Frequência: 5=100; 6ª e seguintes não aumentam o IGA.
const cinco = calculateWeeklyIGA(Array.from({ length: 5 }, () => sessao(60)), perfil);
const seis = calculateWeeklyIGA(Array.from({ length: 6 }, () => sessao(60)), perfil);
const sete = calculateWeeklyIGA(Array.from({ length: 7 }, () => sessao(60)), perfil);
conferir('5 sessões usam F=100', cinco.Fn === 1, `F=${cinco.Fn}`);
conferir('6ª sessão não aumenta F', seis.Fn === 1, `F=${seis.Fn}`);
conferir('6ª sessão não aumenta o IGA', seis.igaRanking === cinco.igaRanking, `${seis.igaRanking}=${cinco.igaRanking}`);
conferir('7ª sessão também não aumenta o IGA', sete.igaRanking === cinco.igaRanking, `${sete.igaRanking}=${cinco.igaRanking}`);
conferir('Frequência auditada fica limitada a 5', seis.frequency === 5 && sete.frequency === 5, `6->${seis.frequency} 7->${sete.frequency}`);

// 4. Sessão reprovada pelo antifraude não entra.
const comReprovada = calculateWeeklyIGA([sessao(60), sessao(60), sessao(60, 'workout', 143, 0, false)], perfil);
conferir('Sessão reprovada não entra na frequência', comReprovada.frequency === 2, `F=${comReprovada.frequency}`);

// 5. Calorias saíram totalmente da pontuação.
const kcalNormal = calculateWeeklyIGA([sessao(60, 'workout', 143, 500)], perfil);
const kcalAbsurda = calculateWeeklyIGA([sessao(60, 'workout', 143, 3000)], perfil);
conferir('Calorias diferentes não mudam o IGA', kcalNormal.igaRanking === kcalAbsurda.igaRanking, `${kcalNormal.igaRanking}=${kcalAbsurda.igaRanking}`);
conferir('Gate calórico não reduz mais score', kcalAbsurda.overallGate === 1, `gate=${kcalAbsurda.overallGate}`);

// 6. Zona de transição: em torno da fronteira Z3/Z4 (80% de 190 = 152 bpm)
// o fator deve mudar gradualmente, sem degrau por 1 bpm.
const i147 = heartRateToIntensityFactor(147, 190);
const i152 = heartRateToIntensityFactor(152, 190);
const i157 = heartRateToIntensityFactor(157, 190);
conferir('Transição Z3/Z4 é crescente e contínua', i147 < i152 && i152 < i157, `${i147.toFixed(3)} < ${i152.toFixed(3)} < ${i157.toFixed(3)}`);
conferir('Centro da transição mistura Z3 e Z4', Math.abs(i152 - 1.075) < 0.001, `I=${i152.toFixed(3)}`);

// 7. Z4 é o maior bônus; Z5 não supera Z4.
const z4 = heartRateToIntensityFactor(165, 190); // dentro de Z4 fora das transições
const z5 = heartRateToIntensityFactor(180, 190); // Z5
conferir('Z4 vale mais que Z5', z4 > z5, `Z4=${z4.toFixed(3)} Z5=${z5.toFixed(3)}`);

// 8. Sem teto artificial: 5 sessões fortes ainda podem passar de 100.
const acima100 = calculateWeeklyIGA(Array.from({ length: 5 }, () => sessao(90, 'workout', 165)), perfil);
conferir('IGA pode passar de 100', acima100.igaRanking > 100, `IGA=${acima100.igaRanking}`);

// 9. Série de FC é preferida à FC média e passa por suavização/zonas.
const inicio = Date.parse('2026-09-10T12:00:00.000Z');
const samples = Array.from({ length: 61 }, (_, i) => ({
  timestamp: new Date(inicio + i * 30_000).toISOString(),
  bpm: i % 10 === 0 ? 190 : 153,
}));
const comSerie = calculateWeeklyIGA([sessao(30, 'cardio', 190, 0, true, { heartRateSamples: samples })], perfil);
conferir('Série de FC é usada quando disponível', comSerie.topSessions[0]?.intensitySource === 'samples', `fonte=${comSerie.topSessions[0]?.intensitySource}`);
conferir('Picos isolados não transformam tudo em Z5', (comSerie.topSessions[0]?.intensityFactor || 0) > 1 && (comSerie.topSessions[0]?.intensityFactor || 0) < 1.15, `I=${comSerie.topSessions[0]?.intensityFactor}`);

console.log(`\n${falhas === 0 ? 'Todas as regras IGA 2.0 passaram.' : falhas + ' regra(s) falharam.'}`);
process.exit(falhas === 0 ? 0 : 1);
