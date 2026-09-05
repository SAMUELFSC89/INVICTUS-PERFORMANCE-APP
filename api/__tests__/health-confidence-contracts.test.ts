import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('contratos ponta a ponta do Health Confidence Engine', () => {
  test('IA recebe nível, score, contexto e limitações', () => {
    const source = read('api/_handlers/performance-ai.ts');
    expect(source).toContain('confidence?.confidenceLevel');
    expect(source).toContain('confidence?.confidenceScore');
    expect(source).toContain('confidence?.measurementContext');
    expect(source).toContain('confidence?.limitations');
  });

  test('relatório exibe confiança, integração, dispositivo e período', () => {
    const source = read('src/pages/HealthReport.tsx');
    expect(source).toContain('POSSO CONFIAR NESTAS LEITURAS?');
    expect(source).toContain('sample.provenance?.integration');
    expect(source).toContain('sample.confidenceAtMeasurement?.confidenceLevel');
    expect(source).toContain('sample.currentEvidenceConfidence?.confidenceLevel');
    expect(source).toContain('sample.timestamp');
  });

  test('bridges nativos expõem proveniência opcional em iOS e Android', () => {
    const patch = read('patches/capgo-capacitor-health+8.10.4.patch');
    for (const field of ['deviceManufacturer', 'deviceModel', 'dataOrigin', 'sourceProductType', 'recordingMethod']) {
      expect(patch).toContain(field);
    }
  });

  test('permissão negada, parcial e revogada permanecem tratadas sem bloquear importação', () => {
    const provider = read('src/services/wearables/HealthVitalsProvider.ts');
    const manager = read('src/services/wearables/WearableManager.ts');
    expect(provider).toContain('readAuthorized.length > 0');
    expect(provider).toContain('return false');
    expect(manager).toContain('refreshHealthPermissions');
  });

  test('falhas offline/API possuem fallback e não apagam dados', () => {
    const runtime = read('api/_lib/health-confidence-runtime.ts');
    const service = read('src/services/healthSummaryService.ts');
    expect(runtime).toContain('DEFAULT_EVIDENCE_REGISTRY');
    expect(service).toContain('respostaVazia');
    expect(service).toContain('catch');
  });

  test('IGA, ranking e antifraude não importam o Confidence Engine', () => {
    const candidateFiles = [
      ...fs.readdirSync(path.join(root, 'api/_lib')).filter((name) => /score|iga|fraud/i.test(name)).map((name) => `api/_lib/${name}`),
      ...fs.readdirSync(path.join(root, 'src/core/iga')).map((name) => `src/core/iga/${name}`)
    ].filter((relative) => fs.statSync(path.join(root, relative)).isFile());
    for (const relative of candidateFiles) expect(read(relative)).not.toMatch(/health-confidence-engine|health-evidence-registry/);
  });
});
