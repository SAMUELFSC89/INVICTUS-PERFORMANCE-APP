import fs from 'node:fs';
import path from 'node:path';
import { parseNativeStravaCallback, resolveNativeDeepLinkRoute } from '../lib/nativeDeepLinks';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Gate 1 — integridade de deep links e Live Activity nativa', () => {
  it('resolve apenas o deep link conhecido da atividade em andamento', () => {
    expect(resolveNativeDeepLinkRoute('invictus://activity')).toBe('/activity/ongoing');
    expect(resolveNativeDeepLinkRoute('invictus://activity/')).toBe('/activity/ongoing');
    expect(resolveNativeDeepLinkRoute('invictus://activity/anything')).toBeNull();
    expect(resolveNativeDeepLinkRoute('invictus://evil')).toBeNull();
    expect(resolveNativeDeepLinkRoute('https://www.invictusperformance.app.br/activity')).toBeNull();
    expect(resolveNativeDeepLinkRoute('not a url')).toBeNull();
  });

  it('restaura destino seguro no retorno nativo do Strava', () => {
    expect(parseNativeStravaCallback('invictus://strava-callback?strava=connected&returnPath=%2Fprofile%2Fwearables')).toEqual({
      outcome: 'connected',
      returnPath: '/profile/wearables',
    });
    expect(parseNativeStravaCallback('invictus://strava-callback?strava=error')).toEqual({
      outcome: 'error',
      returnPath: '/profile/wearables',
    });
    expect(parseNativeStravaCallback('invictus://strava-callback?returnPath=https%3A%2F%2Fevil.test')).toEqual({
      outcome: 'connected',
      returnPath: '/profile/wearables',
    });
    expect(parseNativeStravaCallback('https://evil.test/strava-callback')).toBeNull();
  });

  it('processa warm start e cold start no MobileBridge', () => {
    const bridge = read('src/components/MobileBridge.tsx');
    expect(bridge).toContain("CapApp.addListener('appUrlOpen'");
    expect(bridge).toContain('CapApp.getLaunchUrl()');
    expect(bridge).toContain('resolveNativeDeepLinkRoute(rawUrl)');
    expect(bridge).toContain('parseNativeStravaCallback(rawUrl)');
    expect(bridge).toContain('launchUrlHandledRef');
  });

  it('mantém o fallback iOS 16 ligado a uma rota que o bridge reconhece', () => {
    const widget = read('ios/App/InvictusActivityWidget/InvictusActivityLiveActivityWidget.swift');
    expect(widget).toContain('URL(string: "invictus://activity")');
    expect(resolveNativeDeepLinkRoute('invictus://activity')).toBe('/activity/ongoing');
  });

  it('compila os LiveActivityIntent no source compartilhado dos dois targets', () => {
    const shared = read('ios/App/App/InvictusActivityAttributes.swift');
    const legacyIntentFile = read('ios/App/InvictusActivityWidget/InvictusActivityIntents.swift');
    const project = read('ios/App/App.xcodeproj/project.pbxproj');
    const sourcesSection = project.match(/\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//)?.[1] || '';

    expect(shared).toContain('struct ToggleActivityPauseIntent: LiveActivityIntent');
    expect(shared).toContain('struct FinishActivityIntent: LiveActivityIntent');
    expect(legacyIntentFile).not.toContain('struct ToggleActivityPauseIntent');
    expect(legacyIntentFile).not.toContain('struct FinishActivityIntent');
    expect((sourcesSection.match(/InvictusActivityAttributes\.swift in Sources/g) || []).length).toBe(2);
  });

  it('não perde ação do Live Activity antes de o listener JS existir', () => {
    const plugin = read('ios/App/App/InvictusActivityPlugin.swift');
    expect(plugin).toContain('handlePendingActionFromIntent()');
    expect(plugin).toContain('retainUntilConsumed: true');
    expect(plugin).toContain('InvictusActivityIPC.pendingActionKey');
  });
});
