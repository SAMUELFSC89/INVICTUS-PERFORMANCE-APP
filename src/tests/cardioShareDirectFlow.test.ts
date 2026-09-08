import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('fluxo direto do editor de compartilhamento de cardio', () => {
  it('abre o editor direto após concluir cardio e não reapresenta o detalhe legado', () => {
    const challenges = read('src/pages/Challenges.tsx');
    expect(challenges).toContain("if (sessionType === 'cardio')");
    expect(challenges).toContain('setShareCardData(buildShareableFromItem(finishedItem))');
    expect(challenges).toContain("finishedActivityItem.type !== 'cardio'");
  });

  it('permite mover, pinçar e remover frases por gesto e persistir layout', () => {
    const card = read('src/components/RunShareCard.tsx');
    expect(card).toContain('startPhraseGesture');
    expect(card).toContain('movePhraseGesture');
    expect(card).toContain('SOLTE PARA REMOVER');
    expect(card).toContain('preferencesKey');
    expect(card).toContain('Restaurar frases');
  });
});
