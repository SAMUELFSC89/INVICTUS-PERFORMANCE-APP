import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Gate 1 — iOS privacy manifest / Required Reason API', () => {
  test.each([
    'ios/App/App/PrivacyInfo.xcprivacy',
    'ios/App/InvictusActivityWidget/PrivacyInfo.xcprivacy',
  ])('%s declara UserDefaults do App Group com motivo aprovado', (file) => {
    const manifest = read(file);
    expect(manifest).toContain('NSPrivacyAccessedAPICategoryUserDefaults');
    expect(manifest).toContain('<string>1C8F.1</string>');
  });

  test('app e widget realmente usam UserDefaults do mesmo App Group', () => {
    const attributes = read('ios/App/App/InvictusActivityAttributes.swift');
    const plugin = read('ios/App/App/InvictusActivityPlugin.swift');
    expect(attributes).toContain('UserDefaults(suiteName: InvictusActivityIPC.appGroupId)');
    expect(plugin).toContain('UserDefaults(suiteName: InvictusActivityIPC.appGroupId)');
  });

  test('ambos os manifests pertencem ao target correto e entram em Copy Bundle Resources', () => {
    const project = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(project).toContain('AA11BB22CC33DD44EE55FF01 /* PrivacyInfo.xcprivacy */');
    expect(project).toContain('AA11BB22CC33DD44EE55FF02 /* PrivacyInfo.xcprivacy */');
    expect(project).toContain('AA11BB22CC33DD44EE55FF03 /* PrivacyInfo.xcprivacy in Resources */');
    expect(project).toContain('AA11BB22CC33DD44EE55FF04 /* PrivacyInfo.xcprivacy in Resources */');
  });
});
