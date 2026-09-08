import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('contrato nativo do card de compartilhamento', () => {
  it('registra o mesmo plugin no JavaScript, Android e iOS', () => {
    expect(read('src/services/shareCardExportService.ts')).toContain("registerPlugin<NativeShareCardPlugin>('InvictusShareCard')");
    expect(read('android/app/src/main/java/com/desafiosemdesculpa/app/MainActivity.java')).toContain('registerPlugin(InvictusShareCardPlugin.class)');
    expect(read('ios/App/App/InvictusBridgeViewController.swift')).toContain('registerPluginInstance(InvictusShareCardPlugin())');
    expect(read('ios/App/App.xcodeproj/project.pbxproj')).toContain('InvictusShareCardPlugin.swift in Sources');
  });

  it('remove do card o modelo antigo com velocidade, divisórias e ícones de métricas', () => {
    const card = read('src/components/RunShareCard.tsx');
    expect(card).not.toContain('VELOCIDADE');
    expect(card).not.toContain('share-card-divider');
    expect(card).not.toContain('share-card-metric-icon');
  });
});

