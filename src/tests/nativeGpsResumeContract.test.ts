import fs from 'node:fs';
import path from 'node:path';

describe('Gate 1 — contrato nativo de retomada GPS', () => {
  const root = process.cwd();

  test('iOS associa o buffer persistido ao sessionId e limpa owner divergente', () => {
    const source = fs.readFileSync(path.join(root, 'ios/App/App/InvictusActivityPlugin.swift'), 'utf8');
    expect(source).toContain('CAPPluginMethod(name: "resumeLocationTracking"');
    expect(source).toContain('@objc func resumeLocationTracking');
    expect(source).toContain('trackedSessionIdKey = "invictus.background.sessionId"');
    expect(source).toContain('self.trackedSessionId != sessionId');
    expect(source).toContain('beginLocationTracking(call, clearExisting: false)');
    expect(source).toContain('beginLocationTracking(call, clearExisting: true)');
    expect(source).toContain('call.getBool("clear") == true');
    expect(source).toContain('result["sessionId"] = trackedSessionId');
  });

  test('Android associa SharedPreferences ao sessionId e não retoma buffer estrangeiro', () => {
    const source = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/desafiosemdesculpa/app/InvictusActivityPlugin.java'), 'utf8');
    expect(source).toContain('SESSION_ID_KEY = "background_session_id"');
    expect(source).toContain('public void resumeLocationTracking(PluginCall call)');
    expect(source).toContain('!sessionId.equals(trackedSessionId)');
    expect(source).toContain('beginLocationTracking(call, false)');
    expect(source).toContain('beginLocationTracking(call, true)');
    expect(source).toContain('Boolean clear = call.getBoolean("clear")');
    expect(source).toContain('result.put("sessionId", trackedSessionId)');
    expect(source).toContain('restoreLocations();');
  });

  test('ponte TypeScript passa sessionId, falha fechado na leitura e limpa no encerramento', () => {
    const source = fs.readFileSync(path.join(root, 'src/services/nativeBackgroundLocationService.ts'), 'utf8');
    expect(source).toContain('resumeLocationTracking(options: NativeSessionOptions): Promise<void>');
    expect(source).toContain('readBufferedSnapshot(): Promise<NativeBufferedLocations>');
    expect(source).toContain('if (!ownerSessionId || buffered.sessionId !== ownerSessionId) return []');
    expect(source).toContain('NativeActivityLocation.startLocationTracking({ sessionId: ownerSessionId })');
    expect(source).toContain('NativeActivityLocation.resumeLocationTracking({ sessionId: ownerSessionId })');
    expect(source).toContain('stopLocationTracking({ clear: false })');
    expect(source).toContain('stopLocationTracking({ clear: true })');
  });

  test('restore remoto só reaplica a cauda quando o owner nativo é a mesma sessão', () => {
    const source = fs.readFileSync(path.join(root, 'src/services/sessionContinuityService.ts'), 'utf8');
    expect(source).toContain('readBufferedSnapshot()');
    expect(source).toContain('bufferedBeforeRestore.sessionId === restored.id');
    expect(source).toContain('replayRecoveredTail(restored, bufferedBeforeRestore.locations)');
    expect(source).toContain('Buffer GPS persistido pertence a outra sessão; pontos antigos foram ignorados.');
  });

  test('buffer restaurado importa somente a cauda posterior ao checkpoint já persistido', () => {
    const source = fs.readFileSync(path.join(root, 'src/services/webGpsTrackingService.ts'), 'utf8');
    expect(source).toContain('latestCheckpointTimestampMs');
    expect(source).toContain('if (timestampMs <= latestKnownMs || timestampMs > Date.now() + 60_000) continue');
    expect(source).toContain('latestKnownMs = timestampMs');
  });
});
