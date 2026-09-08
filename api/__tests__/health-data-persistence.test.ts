});

test('migração ao toque não copia nem sobrescreve documento de outra conta', async () => {
  const legacyId = `${daily.source}_${daily.metricType}_${Buffer.from(daily.sampleId!).toString('base64url')}`;
  store.set(`health_samples/${legacyId}`, { ...daily, userId: 'user-B', id: legacyId, createdAt: now, value: 8000 });
  await persistirAmostraSaude(daily);
  expect(store.get(`health_samples/${legacyId}`)!.userId).toBe('user-B');
  expect(store.get(`health_samples/${legacyId}`)!.value).toBe(8000);
  expect(store.get(`health_samples/${healthSampleDocumentId(daily)}`)!.value).toBe(1000);
});

test('migração mantém histórico próprio e leitura escolhe apenas v2', async () => {
  const legacyId = `${daily.source}_${daily.metricType}_${Buffer.from(daily.sampleId!).toString('base64url')}`;
  const historical = { ...daily, id: legacyId, createdAt: '2026-08-01T00:00:00.000Z', confidenceAtMeasurement: { confidenceScore: 31, measurementContext: 'daily_living' } };
  store.set(`health_samples/${legacyId}`, historical);
  expect(await persistirAmostraSaude(daily)).toBe('duplicate');
  const current = store.get(`health_samples/${healthSampleDocumentId(daily)}`)!;
  expect(current.createdAt).toBe(historical.createdAt);
  expect(current.confidenceAtMeasurement).toEqual(historical.confidenceAtMeasurement);
  expect(deduplicateHealthSamples([historical, current] as HealthSample[]).samples).toHaveLength(1);
});

test('sumário consulta uma vez por métrica e preserva falha parcial', async () => {
  failMetric = 'heart_rate';
  const summary = await buildHealthSummary('user-A', 30, 'America/Sao_Paulo');
  // 23 métricas do resumo/tendências + steps_activity, usado somente para
  // descontar passos já atribuídos aos treinos na consolidação de energia.
  expect(queryCount).toBe(24);
  expect(summary.metadata.partial).toBe(true);
  expect(summary.metadata.metrics.heart_rate).toMatchObject({ error: true, partial: true });
  expect(summary.metadata.metrics.steps_daily?.partial).toBe(false);
  expect(summary.metadata.metrics.steps_activity?.partial).toBe(false);
  expect(summary.metadata.timeZone).toBe('America/Sao_Paulo');
});

test('limite de leitura explícito sinaliza série parcial', async () => {
  for (let index = 0; index < 5; index++) store.set(`health_samples/${index}`, { ...daily, sampleId: String(index), id: String(index), timestamp: `2026-09-04T0${index}:00:00.000Z`, schemaVersion: 2 });
  const result = await lerSerieTemporalMetricaComLimite('user-A', 'steps_daily', new Date('2026-09-01'), new Date(now), 3);
  expect(result.partial).toBe(true); expect(result.scannedCount).toBe(4); expect(result.samples).toHaveLength(3);
});

test('agregação prefere total diário a calorias de treino e não soma duas plataformas', () => {
  const sample = { ...daily, id: 'a', createdAt: now, metricType: 'calories_active' } as HealthSample;
  const output = aggregateDailyHealthSamples('calories_active', [sample, { ...sample, id: 'b', aggregation: 'sample', sourceActivityId: 'workout', value: 250 }, { ...sample, id: 'c', source: 'health_connect', value: 1600 }]);
  expect(output).toHaveLength(1); expect(output[0].value).toBe(1000); expect(output[0].aggregationMethod).toBe('daily_total');
});

test('HRV e FC não combinam dispositivos/contextos diferentes no mesmo dia', () => {
  const sample = { ...daily, aggregation: 'sample', id: 'a', createdAt: now, metricType: 'hrv_sdnn', device: 'old', value: 30, timestamp: '2026-09-04T08:00:00.000Z' } as HealthSample;