import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

// Bug reportado pelo usuário: ao criar um objetivo de cardio, o app pedia
// para "confirmar a data de nascimento no perfil" -- mas não existe nenhum
// campo de data de nascimento na tela de Perfil (ProfileNew.tsx), e o único
// lugar que já coletava birthDate (a tela "COMPLETE SEU PERFIL" do
// AuthGuard) só reabria quando faltava aceitar os termos, nunca quando só
// faltava a data de nascimento. Resultado: quem tinha termsAccepted=true mas
// birthDate ausente/vazia ficava permanentemente travado na criação da
// jornada de cardio, sem nenhuma tela no app capaz de corrigir isso.
describe('correção do beco sem saída de data de nascimento no fluxo de cardio', () => {
  test('AuthGuard reabre a tela de completar perfil quando falta birthDate, não só quando falta aceitar os termos', () => {
    const authGuard = read('src/components/AuthGuard.tsx');
    expect(authGuard).toContain('const isIncomplete = !user.termsAccepted || !user.birthDate;');
  });

  test('AuthGuard pré-preenche os campos já conhecidos ao reabrir só por causa da data de nascimento', () => {
    const authGuard = read('src/components/AuthGuard.tsx');
    // Sem isso, alguém que só está faltando birthDate seria forçado a
    // redigitar CPF/altura/peso/cidade que já tinha informado antes.
    expect(authGuard).toContain("if (user.cpf) setCpf(user.cpf);");
    expect(authGuard).toContain("if (user.birthDate) setBirthDate(user.birthDate.slice(0, 10));");
    expect(authGuard).toContain("if (user.height) setHeight(String(user.height));");
    expect(authGuard).toContain("if (user.weight) setWeight(String(user.weight));");
  });

  test('a jornada de cardio nunca mais aponta pra um campo de perfil que não existe', () => {
    const profile = read('src/pages/ProfileNew.tsx');
    const cardioHandler = read('api/_handlers/cardio-objective.ts');

    // Confirma a premissa do bug: ProfileNew realmente não tem campo de
    // data de nascimento -- então apontar o usuário pra lá era um beco sem
    // saída real, não só uma mensagem ruim.
    expect(profile).not.toContain('birthDate');

    expect(cardioHandler).not.toContain('Confirme a data de nascimento no perfil');
    expect(cardioHandler).toContain('Precisamos confirmar sua data de nascimento antes de criar esta jornada.');
  });

  test('o bloqueio de segurança contra menores de idade continua intacto', () => {
    const cardioHandler = read('api/_handlers/cardio-objective.ts');
    // Nunca remover: é a defesa em profundidade final contra menores,
    // mesmo com o AuthGuard agora barrando o caminho normal antes.
    expect(cardioHandler).toContain('if (profile.ageYears < 18)');
    expect(cardioHandler).toContain("throw new ObjectiveError('Esta jornada é destinada a adultos.');");
  });
});
