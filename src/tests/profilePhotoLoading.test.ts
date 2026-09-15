import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('foto de perfil resiliente', () => {
  const avatar = read('src/components/ProfilePhotoImage.tsx');
  const profile = read('src/pages/ProfileNew.tsx');
  const service = read('src/services/userService.ts');
  const utils = read('src/lib/utils.ts');

  it('aceita os campos de avatar atuais e legados', () => {
    expect(avatar).toContain('data.photoURL');
    expect(avatar).toContain('data.photoUrl');
    expect(avatar).toContain('data.photo_url');
  });

  it('resolve referencias antigas do Firebase Storage e tenta renovar urls quebradas', () => {
    expect(avatar).toContain("value.startsWith('gs://')");
    expect(avatar).toContain("value.startsWith('profiles/')");
    expect(avatar).toContain('getDownloadURL(ref(storage, value))');
    expect(avatar).toContain('onError={() => void recover()}');
  });

  it('usa fallback visual em vez de manter imagem quebrada', () => {
    expect(avatar).toContain('fallback?: ReactNode');
    expect(avatar).toContain('if (!resolvedSrc || failed) return <>{fallback}</>');
    expect(profile).toContain('fallback={<UserRound />}');
  });

  it('normaliza novos uploads para photoURL e remove aliases legados', () => {
    expect(service).toContain('photoURL,');
    expect(service).toContain('photoUrl: deleteField()');
    expect(service).toContain('photo_url: deleteField()');
  });

  it('não deixa compressão, download url ou escrita do perfil carregando para sempre no iOS', () => {
    expect(utils).toContain('PROCESSING_TIMEOUT_MS = 15_000');
    expect(utils).toContain('URL.createObjectURL(file)');
    expect(utils).toContain('URL.revokeObjectURL(objectUrl)');
    expect(service).toContain("new Error('UPLOAD_TIMEOUT')");
    expect(service).toContain("'DOWNLOAD_URL_TIMEOUT'");
    expect(service).toContain("'PROFILE_WRITE_TIMEOUT'");
  });

  it('publica a nova foto antes do refresh completo de perfil e estatísticas', () => {
    expect(profile).toContain('setProfilePhotoOverride(uploadedPhotoURL)');
    expect(profile).toContain('refreshProfileInBackground()');
    expect(profile).not.toContain('await refreshUser();');
  });
});
