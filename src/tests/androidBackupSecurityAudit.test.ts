import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const fileProviderPaths = read('android/app/src/main/res/xml/file_paths.xml');

describe('Gate 1 — Android private app state', () => {
  test('does not cloud-back up authentication, activity and health-adjacent local state', () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:fullBackupContent="false"');
    expect(manifest).not.toContain('android:allowBackup="true"');
  });

  test('FileProvider exposes only the temporary directories actually shared by native plugins', () => {
    expect(fileProviderPaths).toContain('<cache-path name="share_cards" path="share_cards/" />');
    expect(fileProviderPaths).toContain('<cache-path name="instagram_share" path="instagram_share/" />');
    expect(fileProviderPaths).not.toContain('<external-path');
    expect(fileProviderPaths).not.toContain('path="."');
  });
});
