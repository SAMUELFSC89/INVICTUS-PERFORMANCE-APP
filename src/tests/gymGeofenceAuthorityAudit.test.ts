import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('autoridade da academia e geofence', () => {
  it('perfil do cliente não pode escrever identidade/localização da academia', () => {
    const rules = read('firestore.rules');
    expect(rules).toContain("'gymId', 'gymName', 'gymLocation', 'gymAddress', 'lastGymChange'");
  });

  it('check-in usa somente documento canônico da academia', () => {
    const handler = read('api/_handlers/gyms_checkin.ts');
    expect(handler).toContain("db.collection('gyms').doc(String(userData.gymId)).get()");
    expect(handler).toContain('if (!gymSnap.exists)');
    expect(handler).not.toContain('userData.gymLocation');
    expect(handler).toContain('gymName: canonicalGymName');
  });

  it('academia nova é resolvida no Google pelo servidor antes de persistir', () => {
    const handler = read('api/_handlers/gyms_join.ts');
    expect(handler).toContain('resolveCanonicalGoogleGym(gymId)');
    expect(handler).toContain('https://places.googleapis.com/v1/places/');
    expect(handler).toContain("source: 'google_places'");
  });
});
