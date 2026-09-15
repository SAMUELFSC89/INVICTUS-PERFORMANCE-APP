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

  it('usa snapshot nativo limpo da WKWebView em 1080x1920 e JPEG 94%', () => {
    const iosPlugin = read('ios/App/App/InvictusShareCardPlugin.swift');
    expect(iosPlugin).toContain('import WebKit');
    expect(iosPlugin).toContain("document.querySelector('.share-card-art')");
    expect(iosPlugin).toContain('WKSnapshotConfiguration()');
    expect(iosPlugin).toContain('webView.takeSnapshot');
    expect(iosPlugin).toContain('configuration.snapshotWidth = NSNumber(value: 1080)');
    expect(iosPlugin).toContain('CGSize(width: 1080, height: 1920)');
    expect(iosPlugin).toContain('jpegData(compressionQuality: 0.94)');
    expect(iosPlugin).toContain("'.share-screen-toolbar, .share-context-controls, .share-card-notices, .share-customizer-backdrop'");
    expect(iosPlugin).toContain('restoreEditorChrome');
    expect(iosPlugin).toContain('completion(self.imageData(from: call))');
  });

  it('isola arquivos temporários do share no iOS e não aceita caminho no nome vindo do JavaScript', () => {
    const iosPlugin = read('ios/App/App/InvictusShareCardPlugin.swift');
    expect(iosPlugin).toContain('invictus-share-\\(UUID().uuidString)');
    expect(iosPlugin).toContain('private func safeFileName(_ value: String)');
    expect(iosPlugin).toContain('of: "[^a-zA-Z0-9._-]"');
    expect(iosPlugin).toContain('removeItem(at: shareDirectory)');
    expect(iosPlugin).not.toContain('temporaryDirectory.appendingPathComponent(safeName)');
  });

  it('Android compartilha a URI com MIME correto e ClipData', () => {
    const androidPlugin = read('android/app/src/main/java/com/desafiosemdesculpa/app/InvictusShareCardPlugin.java');
    expect(androidPlugin).toContain('intent.setType(mimeType)');
    expect(androidPlugin).toContain('intent.setClipData(ClipData.newRawUri');
    expect(androidPlugin).toContain('Intent.FLAG_GRANT_READ_URI_PERMISSION');
  });

  it('remove velocidade e divisórias antigas, mas mantém os ícones do layout aprovado', () => {
    const card = read('src/components/RunShareCard.tsx');
    expect(card).not.toContain('VELOCIDADE');
    expect(card).not.toContain('share-card-divider');
    expect(card).toContain('share-card-metric-icon');
  });
});
