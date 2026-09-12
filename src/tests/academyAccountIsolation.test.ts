import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('isolamento da troca de academia entre contas', () => {
  it('serviço captura UID e rejeita resposta obsoleta após troca de conta', () => {
    const service = read('src/services/gymService.ts');
    expect(service).toContain('const expectedUid = user.uid');
    expect(service).toContain('auth.currentUser?.uid !== expectedUid');
    expect(service).toContain("return { success: true, userId: expectedUid }");
  });

  it('tela só recarrega perfil e navega enquanto a mesma conta continua ativa', () => {
    const page = read('src/pages/AcademyConfirm.tsx');
    expect(page).toContain('const expectedUid = user.uid');
    expect(page).toContain('result.userId !== expectedUid');
    expect(page).toContain('await refreshUser?.()');
    expect(page).toContain("if (auth.currentUser?.uid !== expectedUid) return;");
  });
});
