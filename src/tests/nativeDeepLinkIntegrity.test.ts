import fs from 'node:fs';
import path from 'node:path';
import { describeNativeDeepLinkForLog, parseNativeStravaCallback, resolveNativeDeepLinkRoute } from '../lib/nativeDeepLinks';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Gate 1 — integridade de deep links e Live Activity nativa', () => {
  it('resolve apenas deep links internos explicitamente permitidos', () => {
    expect(resolveNativeDeepLinkRoute('invictus://activity')).toBe('/activity/ongoing');
    expect(resolveNativeDeepLinkRoute('invictus://activity/')).toBe('/activity/ongoing');
    expect(resolveNativeDeepLinkRoute('invictus://championship-checkout?status=success&championshipId=invictus_cardio_v1'))
      .toBe('/championships/checkout-return?status=success&championshipId=invictus_cardio_v1');
    expect(resolveNativeDeepLinkRoute('invictus://championship-checkout?status=expired&championshipId=invictus_strength_v1'))
      .toBe('/championships/checkout-return?status=expired&championshipId=invictus_strength_v1');
    expect(resolveNativeDeepLinkRoute('invictus://championship-checkout?status=paid&championshipId=invictus_cardio_v1')).toBeNull();
    expect(resolveNativeDeepLinkRoute('invictus://championship-checkout?status=success&championshipId=evil')).toBeNull();
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

  it('nunca coloca query/fragment OAuth ou de pagamento no texto de diagnóstico', () => {
    const described = describeNativeDeepLinkForLog(
      'invictus://strava-callback/oauthredirect?code=secret-code&state=secret-state&access_token=secret-token#fragment-secret',
    );
    expect(described).toBe('invictus://strava-callback/oauthredirect');
    expect(described).not.toContain('secret-code');
    expect(described).not.toContain('secret-state');
    expect(described).not.toContain('secret-token');
    expect(described).not.toContain('fragment-secret');
    expect(describeNativeDeepLinkForLog('not a url')).toBe('[native-url-invalida]');

    const bridge = read('src/components/MobileBridge.tsx');
    expect(bridge).toContain('describeNativeDeepLinkForLog(rawUrl)');
    expect(bridge).not.toContain("console.log('[MobileBridge] Deep link recebido:', rawUrl)");
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

  it('preserva todos os toques da Live Activity antes de o listener JS existir', () => {
    const shared = read('ios/App/App/InvictusActivityAttributes.swift');
    const plugin = read('ios/App/App/InvictusActivityPlugin.swift');

    expect(shared).toContain('pendingActionQueueKey');
    expect(shared).toContain('defaults.stringArray(forKey: InvictusActivityIPC.pendingActionQueueKey) ?? []');
    expect(shared).toContain('pending.append(action.rawValue)');
    expect(shared).toContain('maxPendingActionCount');
    expect(shared).not.toContain('defaults.set(action.rawValue, forKey: InvictusActivityIPC.pendingActionKey)');

    expect(plugin).toContain('handlePendingActionFromIntent()');
    expect(plugin).toContain('defaults.stringArray(forKey: InvictusActivityIPC.pendingActionQueueKey) ?? []');
    expect(plugin).toContain('for raw in validActions');
    expect(plugin).toContain('retainUntilConsumed: true');
    expect(plugin).toContain('InvictusActivityIPC.pendingActionKey');
  });

  it('não usa o cache JS como fonte de verdade depois de recriar o WebView', () => {
    const service = read('src/services/activityLiveActivityService.ts');
    const updateStart = service.indexOf('async update(');
    const stopStart = service.indexOf('async stop()', updateStart);
    const updateBlock = service.slice(updateStart, stopStart);
    const stopBlock = service.slice(stopStart);

    expect(updateBlock).not.toContain('!isRunning');
    expect(updateBlock).toContain('await InvictusActivity.update({');
    expect(stopBlock).not.toContain('!isRunning');
    expect(stopBlock).toContain('await InvictusActivity.end()');
  });
});
