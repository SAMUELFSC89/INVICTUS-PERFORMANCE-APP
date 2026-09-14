import fs from 'node:fs';
import path from 'node:path';

const manifest = fs.readFileSync(
  path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'),
  'utf8',
);

describe('Gate 1 — Android private app state backup', () => {
  test('does not cloud-back up authentication, activity and health-adjacent local state', () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:fullBackupContent="false"');
    expect(manifest).not.toContain('android:allowBackup="true"');
  });
});
