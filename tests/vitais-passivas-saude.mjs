/**
 * Verificacao executavel de registrarAmostrasPassivas (#253).
 *
 * Cobre a gravacao das metricas passivas (FC repouso, HRV, sono, peso) lidas
 * via @capgo/capacitor-health -- pipeline SEPARADO do de atividades
 * (tests/ingestao-wearable.mjs), sem SecurityPipeline envolvido.
 *
 * Como rodar: node tests/vitais-passivas-saude.mjs <caminho-do-bundle.mjs>
 * O bundle precisa exportar `registrarAmostrasPassivas` e `__setDb` a partir
 * de api/_lib/health-data-layer.ts (common.ts stubado com Firestore falso).
 */

const caminhoBundle = process.argv[2] || '/tmp/vitais-passivas-bundle.mjs';
const { registrarAmostrasPassivas, __setDb } = await import(caminhoBundle);

let falhas = 0;
const conferir = (nome, condicao, detalhe) => {
  if (!condicao) falhas++;
  console.log(`${condicao ? 'OK  ' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
};

function criarBancoFalso() {
  const colecoes = new Map();
  const colecao = (nome) => {
    if (!colecoes.has(nome)) colecoes.set(nome, new Map());
    return colecoes.get(nome);
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
        },
        create: async (data) => {
          if (colecao(nome).has(id)) {
            const err = new Error('already exists');
            err.code = 6;
            throw err;
          }
          colecao(nome).set(id, data);
        }
      })
    }),
    _dump: (nome) => Object.fromEntries(colecao(nome))
  };
}

// CENARIO 1: as 4 metricas passivas gravam corretamente, com quality
// sensor_verified (vitais nao passam por antifraude).
{
  const banco1 = criarBancoFalso();
  __setDb(banco1);
  const gravadas = await registrarAmostrasPassivas({
    userId: 'user1',
    source: 'apple_health',
    amostras: [
      { metricType: 'heart_rate_resting', value: 58, unit: 'bpm', timestamp: '2026-08-27T06:00:00.000Z', device: 'Apple Watch' },
      { metricType: 'hrv_rmssd', value: 42, unit: 'ms', timestamp: '2026-08-27T06:00:00.000Z' },
      { metricType: 'sleep_duration_min', value: 420, unit: 'min', timestamp: '2026-08-27T06:30:00.000Z' },
      { metricType: 'weight_kg', value: 78.4, unit: 'kg', timestamp: '2026-08-27T07:00:00.000Z' }
    ]
  });
  conferir('Retorna 4 amostras gravadas', gravadas === 4);
  const amostras1 = Object.values(banco1._dump('health_samples'));
  conferir('Gravou heart_rate_resting=58 bpm', amostras1.some(a => a.metricType === 'heart_rate_resting' && a.value === 58 && a.unit === 'bpm'));
  conferir('Gravou hrv_rmssd=42 ms', amostras1.some(a => a.metricType === 'hrv_rmssd' && a.value === 42 && a.unit === 'ms'));
  conferir('Gravou sleep_duration_min=420', amostras1.some(a => a.metricType === 'sleep_duration_min' && a.value === 420));
  conferir('Gravou weight_kg=78.4', amostras1.some(a => a.metricType === 'weight_kg' && a.value === 78.4));
  conferir('Todas quality=sensor_verified (vitais nao passam por antifraude)', amostras1.every(a => a.quality === 'sensor_verified'));
  conferir('Preserva o device quando veio', amostras1.find(a => a.metricType === 'heart_rate_resting')?.device === 'Apple Watch');
}

// CENARIO 2: valores invalidos (<=0, NaN) sao descartados -- nunca inventa
// leitura de saude a partir de dado ausente/corrompido.
{
  const banco2 = criarBancoFalso();
  __setDb(banco2);
  const gravadas = await registrarAmostrasPassivas({
    userId: 'user2',
    source: 'health_connect',
    amostras: [
      { metricType: 'heart_rate_resting', value: 0, unit: 'bpm', timestamp: '2026-08-27T06:00:00.000Z' },
      { metricType: 'weight_kg', value: -5, unit: 'kg', timestamp: '2026-08-27T06:00:00.000Z' },
      { metricType: 'hrv_rmssd', value: NaN, unit: 'ms', timestamp: '2026-08-27T06:00:00.000Z' },
      { metricType: 'sleep_duration_min', value: 380, unit: 'min', timestamp: '2026-08-27T06:00:00.000Z' }
    ]
  });
  conferir('Descarta valores <=0/NaN, grava só a válida', gravadas === 1);
  const amostras2 = Object.values(banco2._dump('health_samples'));
  conferir('Só existe a amostra válida no banco', amostras2.length === 1 && amostras2[0].metricType === 'sleep_duration_min');
}

// CENARIO 3: resincronizar a MESMA leitura (mesmo timestamp) não duplica --
// o id determinístico (source+timestamp+metricType) garante 1 doc por leitura
// real, mesmo que o cliente reenvie uma janela sobreposta.
{
  const banco3 = criarBancoFalso();
  __setDb(banco3);
  const amostra = { metricType: 'heart_rate_resting', value: 60, unit: 'bpm', timestamp: '2026-08-27T06:00:00.000Z' };
  await registrarAmostrasPassivas({ userId: 'user3', source: 'apple_health', amostras: [amostra] });
  await registrarAmostrasPassivas({ userId: 'user3', source: 'apple_health', amostras: [amostra] });
  const amostras3 = Object.values(banco3._dump('health_samples'));
  conferir('Resync da mesma leitura não duplica (1 doc só)', amostras3.filter(a => a.metricType === 'heart_rate_resting').length === 1);
}

// CENARIO 4: lista vazia não quebra e retorna 0.
{
  __setDb(criarBancoFalso());
  const gravadas = await registrarAmostrasPassivas({ userId: 'user4', source: 'apple_health', amostras: [] });
  conferir('Lista vazia: 0 gravadas, sem erro', gravadas === 0);
}

console.log(`\n${falhas === 0 ? 'Vitais passivas: todos os cenários passaram.' : falhas + ' cenário(s) falharam.'}`);
process.exit(falhas === 0 ? 0 : 1);
