import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('foto de perfil resiliente', () => {
  const avatar = read('src/components/ProfilePhotoImage.tsx');
  const profile = read('src/pages/ProfileNew.tsx');
  const service = read('src/services/userService.ts');

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
});
