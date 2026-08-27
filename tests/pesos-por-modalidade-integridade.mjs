/**
 * Verificacao executavel dos pesos de integridade por perfil de validacao (#247).
 *
 * Antes, o Integrity Engine usava um unico conjunto de pesos (20% cada) pra
 * qualquer modalidade. Nisso, GPS valia 20% mesmo em musculacao -- onde
 * requiresGps=false ja fixa o sub-score em 100 e o peso nunca discrimina
 * fraude -- e em cardio, onde GPS e o sinal mais forte contra teleporte/mock
 * location/GPS congelado, pesava igual aos sinais mais fracos.
 *
 * Este teste roda o motor de verdade (nao uma reimplementacao) contra
 * cenarios concretos e confere o score exato, pra pegar regressao de
 * arredondamento ou de pesos trocados.
 *
 * Como rodar: veja scripts/verificar-antifraude.sh
 *   node tests/pesos-por-modalidade-integridade.mjs <caminho-do-bundle.mjs>
 */

const caminhoBundle = process.argv[2] || '/tmp/integrity-bundle.mjs';
const { IntegrityEngine } = await import(caminhoBundle);

let falhas = 0;
const conferir = (nome, condicao, detalhe) => {
  if (!condicao) falhas++;
  console.log(`${condicao ? 'OK  ' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
};

// Musculacao: GPS nao exigido -> sub-score sempre 100, mas o PESO agora e 0,
// entao esse 100 nao infla mais o score final (antes valia 20% de graca).
const strength = { type: 'workout', muscleGroup: 'peito', durationMins: 45, source: 'GYM_CHECKIN' };
const rStrength = IntegrityEngine.calculate(strength);
conferir('Musculacao: gps nao exigido -> sub-score 100', rStrength.details.gpsIntegrityScore === 100);

// Mesmo com accuracy de GPS ruim mandada por engano, musculacao nao pode ser
// penalizada -- ela nunca usa GPS como evidencia (perfil.usaEvidenciaDeDeslocamento=false).
const strengthAccuracyRuim = { type: 'workout', muscleGroup: 'costas', durationMins: 45, gpsAccuracy: 60, source: 'MANUAL' };
const rStrength2 = IntegrityEngine.calculate(strengthAccuracyRuim);
conferir('Musculacao: accuracy de GPS ruim e ignorada (nao exige GPS)', rStrength2.details.gpsIntegrityScore === 100);

// Cardio: GPS ruim (accuracy>50, -40 pontos -> 60) agora pesa 35%, nao 20%.
const cardioRuim = { type: 'RUNNING', durationMins: 30, gpsAccuracy: 60, source: 'STRAVA' };
const rCardioRuim = IntegrityEngine.calculate(cardioRuim);
const esperadoCardio = Math.round(60 * 0.35 + 75 * 0.20 + 100 * 0.20 + 100 * 0.15 + 90 * 0.10);
conferir('Cardio: GPS ruim pesa 35% do score final', rCardioRuim.integrityScore === esperadoCardio, `esperado ${esperadoCardio}, veio ${rCardioRuim.integrityScore}`);

// Power Lift: nao tem peso proprio -- usa o fallback plano (20% cada), e
// usaEvidenciaDeDeslocamento=false eleva o sensorIntegrityScore pra 85 (mesma
// regra que GYM_CHECKIN/musculacao).
const powerlift = { type: 'powerlift_attempt', durationMins: 20, source: 'MANUAL' };
const rPower = IntegrityEngine.calculate(powerlift);
const esperadoPower = Math.round(100 * 0.20 + 75 * 0.20 + 100 * 0.20 + 100 * 0.20 + 85 * 0.20);
conferir('Power Lift: continua no peso plano (fallback)', rPower.integrityScore === esperadoPower, `esperado ${esperadoPower}, veio ${rPower.integrityScore}`);

console.log(`\n${falhas === 0 ? 'Pesos por modalidade: todos os cenarios passaram.' : falhas + ' cenario(s) falharam.'}`);
process.exit(falhas === 0 ? 0 : 1);
