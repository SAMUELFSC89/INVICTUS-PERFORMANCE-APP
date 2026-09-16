import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('activity map privacy and provider-cost guard', () => {
  it('roteia activity-map para o guard antes do catch-all da API', () => {
    const vercel = read('vercel.json');
    const guarded = vercel.indexOf('"source": "/api/activity-map"');
    const legacyGuarded = vercel.indexOf('"source": "/api/app/activity-map"');
    const catchAll = vercel.indexOf('"source": "/api/(.*)"');

    expect(guarded).toBeGreaterThanOrEqual(0);
    expect(legacyGuarded).toBeGreaterThan(guarded);
    expect(catchAll).toBeGreaterThan(legacyGuarded);
    expect(vercel).toContain('"destination": "/api/activity-map-guarded"');
  });

  it('mantem o selo de privacidade coerente com a redacao server-side', () => {
    const detail = read('src/components/ActivityMapView.tsx');
    const guard = read('api/activity-map-guarded.ts');

    expect(detail).toContain('Início e fim ocultos');
    expect(guard).toContain('redactRouteEndpoints(normalized)');
    expect(guard).toContain("X-Invictus-Route-Privacy");
    expect(guard).toContain('PRIVACY_MAX_METERS_PER_ENDPOINT = 200');
  });

  it('nao recoloca endpoints exatos sobre o mapa compartilhado', () => {
    const apiNativa = read('src/apiNativa.ts');
    const privacyCss = read('src/features/shareActivityMapPrivacy.css');

    expect(apiNativa).toContain("import './features/shareActivityMapPrivacy.css'");
    expect(privacyCss).toContain('.share-screen .share-card-map-layer [data-share-map-markers]');
    expect(privacyCss).toContain('display: none !important');
  });

  it('limita tamanho bruto e chamadas externas de forma distribuida', () => {
    const guard = read('api/activity-map-guarded.ts');

    expect(guard).toContain('MAX_RAW_TRAJECTORY_POINTS = 8000');
    expect(guard).toContain('RATE_BURST_MAX = 30');
    expect(guard).toContain('RATE_DAILY_MAX = 180');
    expect(guard).toContain("db.collection('api_rate_limits')");
    expect(guard).toContain("createHash('sha256')");
    expect(guard).not.toContain('subjectId: userId');
  });
});
