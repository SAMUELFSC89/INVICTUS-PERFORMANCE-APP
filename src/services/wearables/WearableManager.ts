import { Capacitor } from '@capacitor/core';
import { auth } from '../../firebase';
import { API_CONFIG } from '../../config';
import { AppleHealthProvider } from './AppleHealthProvider';
import { HealthConnectProvider } from './HealthConnectProvider';
import { StravaProvider } from './StravaProvider';
import { HealthVitalsProvider } from './HealthVitalsProvider';
import type { HealthPermissionSnapshot, HealthVitalsDiagnostics } from './HealthVitalsProvider';
import type { WearableConfig, WearableProvider, WearableSource, WearableSyncLog } from './types';

const READ_HEALTH_PERMISSIONS = [
  'read_heart_rate',
  'read_resting_heart_rate',
  'read_heart_rate_variability',
  'read_steps',
  'read_distance',
  'read_calories',
  'read_workouts',
  'read_sleep',
  'read_weight',
  'read_oxygen_saturation',
  'read_respiratory_rate',
  'read_vo2_max',
  'read_blood_pressure',
  'read_body_composition',
  'read_total_calories',
  'read_exercise_time',
  'read_hydration',
  'read_mindfulness'
];

const CONFIG_PERMISSION_BY_NATIVE_TYPE: Record<string, string> = {
  heartRate: 'read_heart_rate', restingHeartRate: 'read_resting_heart_rate', heartRateVariability: 'read_heart_rate_variability',
  steps: 'read_steps', distance: 'read_distance', calories: 'read_calories', workouts: 'read_workouts', sleep: 'read_sleep',
  weight: 'read_weight', oxygenSaturation: 'read_oxygen_saturation', respiratoryRate: 'read_respiratory_rate', vo2Max: 'read_vo2_max',
  bloodPressure: 'read_blood_pressure', bodyFat: 'read_body_composition',
  totalCalories: 'read_total_calories', exerciseTime: 'read_exercise_time', dietaryWater: 'read_hydration', mindfulness: 'read_mindfulness'
};

const wearablesEndpoint = () => `${API_CONFIG.baseUrl || ''}/api/wearables`;

async function requestWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

type ServerWearableConfig = Partial<WearableConfig>;

function emptyConfig(userId: string): WearableConfig {
  return {
    userId,
    healthConnectConnected: false,
    healthConnectPermissions: [],
    appleHealthConnected: false,
    appleHealthPermissions: [],
    stravaConnected: false,
    // Não ativamos sincronização em segundo plano enquanto a ingestão dos
    // dados for feita exclusivamente pelo backend.
    autoSync: true,
    lastSyncTime: null,
    activityTelemetryVersion: 0,
    healthVitalsVersion: 0,
    lastVitalsSyncTime: null,
    createdAt: '',
    updatedAt: ''
  };
}

function configuredPermissionsFromSnapshot(snapshot: HealthPermissionSnapshot | null): string[] {
  if (!snapshot || snapshot.readStatusKnown === false) return [];
  const authorized = new Set(snapshot.readAuthorized);
  return READ_HEALTH_PERMISSIONS.filter((permission) => Object.entries(CONFIG_PERMISSION_BY_NATIVE_TYPE)
    .some(([nativeType, configPermission]) => configPermission === permission && authorized.has(nativeType)));
}

/**
 * O estado da conexão é persistido pela API autenticada. Este manager não
 * escreve mais em `running_stats`, `workouts`, `biometric_metrics` nem em
 * campos de score/ranking: uma permissão local nunca pode dar pontos ou
 * elegibilidade de ranking.
 */
export class WearableManager {
  private static instance: WearableManager | null = null;
  private readonly providers = new Map<WearableSource, WearableProvider>();
  private config: WearableConfig | null = null;
  private activeUserId: string | null = null;
  private activeVitals: { userId: string; controller: AbortController; promise: Promise<{ savedCount: number; diagnostics?: HealthVitalsDiagnostics }> } | null = null;

  private constructor() {
    this.registerProvider(new HealthConnectProvider());
    this.registerProvider(new AppleHealthProvider());
    this.registerProvider(new StravaProvider());
  }

  public static getInstance(): WearableManager {
    if (!this.instance) this.instance = new WearableManager();
    return this.instance;
  }

  public registerProvider(provider: WearableProvider) {
    this.providers.set(provider.id, provider);
  }

  public getProviders(): WearableProvider[] {
    return Array.from(this.providers.values());
  }

  public getProvider(id: WearableSource): WearableProvider | undefined {
    return this.providers.get(id);
  }

  private currentUserId(): string {
    const userId = auth.currentUser?.uid || null;
    if (this.activeUserId !== userId) {
      this.activeVitals?.controller.abort();
      this.activeVitals = null;
      this.config = null;
      this.activeUserId = userId;
    }
    if (!userId) throw new Error('Usuário não autenticado');
    return userId;
  }

  private assertUser(userId: string) {
    if (this.currentUserId() !== userId) throw new Error('A conta mudou. A sincronização foi cancelada.');
  }

  private async currentConfig(): Promise<WearableConfig> {
    const userId = this.currentUserId();
    const config = this.config?.userId === userId ? this.config : await this.loadConfig();
    this.assertUser(userId);
    return config;
  }

  /** Shared consent gate, including collection performed when ending a session. */
  public async getConnectedNativeProviders(): Promise<WearableProvider[]> {
    const config = await this.currentConfig();
    const platform = Capacitor.getPlatform();
    return this.getProviders().filter((provider) =>
      (platform === 'ios' && provider.id === 'apple_health' && config.appleHealthConnected) ||
      (platform === 'android' && provider.id === 'health_connect' && config.healthConnectConnected));
  }

  public isProviderEnabledForUser(providerId: WearableSource, userId: string): boolean {
    if (auth.currentUser?.uid !== userId || this.config?.userId !== userId) return false;
    return providerId === 'apple_health' ? this.config.appleHealthConnected
      : providerId === 'health_connect' ? this.config.healthConnectConnected : false;
  }

  public getAuthenticatedUserId(): string { return this.currentUserId(); }

  private async getToken(expectedUserId = this.currentUserId()): Promise<string> {
    const user = auth.currentUser;
    if (!user || user.uid !== expectedUserId) throw new Error('A conta mudou. A sincronização foi cancelada.');
    const token = await user.getIdToken();
    this.assertUser(expectedUserId);
    return token;
  }

  private normalizeConfig(input: ServerWearableConfig, userId: string): WearableConfig {
    const fallback = emptyConfig(userId);
    return {
      ...fallback,
      ...input,
      userId,
      healthConnectConnected: input.healthConnectConnected === true,
      appleHealthConnected: input.appleHealthConnected === true,
      stravaConnected: input.stravaConnected === true,
      healthConnectPermissions: Array.isArray(input.healthConnectPermissions)
        ? input.healthConnectPermissions.filter((value): value is string => typeof value === 'string')
        : [],
      appleHealthPermissions: Array.isArray(input.appleHealthPermissions)
        ? input.appleHealthPermissions.filter((value): value is string => typeof value === 'string')
        : [],
      autoSync: input.autoSync === true,
      lastSyncTime: typeof input.lastSyncTime === 'string' ? input.lastSyncTime : null,
      activityTelemetryVersion: Number.isFinite(Number(input.activityTelemetryVersion))
        ? Number(input.activityTelemetryVersion)
        : 0,
      healthVitalsVersion: Number.isFinite(Number(input.healthVitalsVersion))
        ? Number(input.healthVitalsVersion)
        : 0,
      lastVitalsSyncTime: typeof input.lastVitalsSyncTime === 'string' ? input.lastVitalsSyncTime : null,
      lastVitalsSyncBySource: input.lastVitalsSyncBySource,
      healthVitalsVersionBySource: input.healthVitalsVersionBySource,
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : '',
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : ''
    };
  }

  private async requestConfig(method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<WearableConfig> {
    const user = auth.currentUser;
    const userId = this.currentUserId();
    const token = await this.getToken(userId);
    const response = await requestWithTimeout(wearablesEndpoint(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    this.assertUser(userId);
    if (!response.ok) {
      throw new Error(payload?.error || 'Não foi possível atualizar as conexões agora.');
    }
    if (!user || !payload?.config) {
      throw new Error('A configuração de dispositivos retornou dados inválidos.');
    }
    const normalized = this.normalizeConfig(payload.config, user.uid);
    this.config = normalized;
    return normalized;
  }

  /** Carrega apenas o estado confirmado pelo servidor ou fallback seguro local. */
  public async loadConfig(): Promise<WearableConfig> {
    const user = auth.currentUser;
    const fallback = emptyConfig(user?.uid || '');
    if (!user) {
      this.activeVitals?.controller.abort();
      this.activeVitals = null;
      this.activeUserId = null;
      this.config = null;
      return fallback;
    }
    this.currentUserId();

    try {
      return await this.requestConfig('GET');
    } catch (err) {
      console.warn('[WearableManager] Usando configuração local de fallback:', err);
      this.assertUser(user.uid);
      if (this.config?.userId === user.uid) return this.config;
      this.config = fallback;
      return fallback;
    }
  }

  /**
   * Envia somente os campos aceitos pelo endpoint. Identidade, Strava, ranking,
   * pontuação e timestamps continuam exclusivamente no servidor.
   */
  public async updateConfig(updates: Partial<WearableConfig>): Promise<WearableConfig> {
    const config: Record<string, unknown> = {};
    if (typeof updates.healthConnectConnected === 'boolean') config.healthConnectConnected = updates.healthConnectConnected;
    if (typeof updates.appleHealthConnected === 'boolean') config.appleHealthConnected = updates.appleHealthConnected;
    if (typeof updates.autoSync === 'boolean') config.autoSync = updates.autoSync;
    if (Array.isArray(updates.healthConnectPermissions)) config.healthConnectPermissions = updates.healthConnectPermissions;
    if (Array.isArray(updates.appleHealthPermissions)) config.appleHealthPermissions = updates.appleHealthPermissions;
    return this.requestConfig('POST', { action: 'update-config', config });
  }

  /**
   * Solicita acesso somente após o toque do usuário. A marca de conexão é
   * gravada no servidor, mas não concede pontuação: uma futura ingestão
   * validada pelo backend é quem decide ranking/score.
   */
  public async connectProvider(providerId: WearableSource): Promise<boolean> {
    const userId = this.currentUserId();
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Provedor ${providerId} não registrado.`);

    const authorized = await provider.requestPermissions();
    const nativeProvider = providerId === 'apple_health' || providerId === 'health_connect';
    this.assertUser(userId);
    if (!authorized && !nativeProvider) return false;

    // O provedor de atividades cobre treinos/rota/FC por sessão. O provedor
    // de vitais cobre sono, passos diários, FC de repouso, HRV e peso. Ambos
    // precisam ser autorizados no mesmo gesto explícito de conexão do usuário.
    let vitalsAuthorized = true;
    let confirmedHealthPermissions: string[] | undefined;
    if (providerId === 'apple_health' || providerId === 'health_connect') {
      vitalsAuthorized = await HealthVitalsProvider.requestPermissions();
      confirmedHealthPermissions = configuredPermissionsFromSnapshot(await HealthVitalsProvider.checkPermissions());
    }
    this.assertUser(userId);
    if (!authorized && !vitalsAuthorized) return false;

    if (providerId === 'health_connect') {
      await this.updateConfig({
        healthConnectConnected: true,
        healthConnectPermissions: confirmedHealthPermissions || READ_HEALTH_PERMISSIONS
      });
    } else if (providerId === 'apple_health') {
      await this.updateConfig({
        appleHealthConnected: true,
        appleHealthPermissions: confirmedHealthPermissions || READ_HEALTH_PERMISSIONS
      });
    }

    if (vitalsAuthorized && (providerId === 'apple_health' || providerId === 'health_connect')) {
      // Primeira leitura logo após o consentimento: confirma acesso real e
      // evita uma conexão que aparece ativa mas nunca traz sono/passos/vitais.
      await this.syncVitals({ forceVitalsBackfill: true }).catch((error) => console.warn('[WearableManager] Conectado, mas a primeira sincronização de vitais falhou:', error));
    }

    if (providerId === 'apple_health' || providerId === 'health_connect') {
      // A conexão deve entregar também as sessões já existentes, incluindo a
      // curva de FC e os passos da atividade, sem depender de o usuário abrir
      // outra tela ou aguardar o próximo ciclo automático.
      await this.syncAll({ forceActivityTelemetryBackfill: true }).catch((error) => console.warn('[WearableManager] Conectado, mas a primeira sincronização de atividades falhou:', error));
    }

    // Strava conclui o vínculo no callback OAuth do servidor. Não declaramos
    // conexão antes de `GET /api/wearables` confirmar o vínculo salvo.
    return providerId === 'strava' ? false : true;
  }

  public async disconnectProvider(providerId: WearableSource): Promise<void> {
    this.currentUserId();
    this.activeVitals?.controller.abort();
    if (this.config && providerId === 'apple_health') this.config.appleHealthConnected = false;
    if (this.config && providerId === 'health_connect') this.config.healthConnectConnected = false;
    const provider = this.getProvider(providerId);
    if (provider) await provider.disconnect();

    if (providerId === 'health_connect') {
      await this.updateConfig({ healthConnectConnected: false, healthConnectPermissions: [] });
    } else if (providerId === 'apple_health') {
      await this.updateConfig({ appleHealthConnected: false, appleHealthPermissions: [] });
    } else {
      // O OAuth do Strava é encerrado no endpoint próprio do provedor. A
      // recarga abaixo mostra apenas o status confirmado pelo backend.
      await this.loadConfig();
    }
  }

  /** Reabre o consentimento granular somente após ação explícita na tela Saúde. */
  public async refreshHealthPermissions(): Promise<boolean> {
    const config = await this.currentConfig();
    const userId = this.currentUserId();
    if (!config.appleHealthConnected && !config.healthConnectConnected) return false;
    const authorized = await HealthVitalsProvider.requestPermissions();
    if (!authorized) return false;
    const confirmedPermissions = configuredPermissionsFromSnapshot(await HealthVitalsProvider.checkPermissions());
    this.assertUser(userId);
    await this.updateConfig({
      ...(config.appleHealthConnected ? { appleHealthPermissions: confirmedPermissions } : {}),
      ...(config.healthConnectConnected ? { healthConnectPermissions: confirmedPermissions } : {})
    });
    await this.syncVitals({ forceVitalsBackfill: true });
    await this.syncAll({ forceActivityTelemetryBackfill: true }).catch((error) => console.warn('[WearableManager] Permissões atualizadas, mas a ressincronização das atividades falhou:', error));
    return true;
  }

  /**
   * #248: agora existe ingestão real no servidor (api/_handlers/wearables.ts,
   * action "sync" -> api/_lib/wearable-sync-service.ts). Este método só LÊ do
   * HealthKit/Health Connect (dado local) e manda pro servidor -- quem decide
   * se aquilo pontua é o SecurityPipeline lá, nunca o cliente. Isso preserva a
   * garantia que já existia: uma permissão local não concede pontuação
   * sozinha.
   *
   * O Strava não entra aqui -- ele já tem sincronização própria via OAuth
   * server-side (/api/strava/sync, StravaService.sync()).
   */
  public async syncAll(options: { forceActivityTelemetryBackfill?: boolean } = {}): Promise<{ syncedCount: number; duplicatesSkipped: number; blockedCount: number; logs: WearableSyncLog[] }> {
    const userId = this.currentUserId();
    const token = await this.getToken(userId);
    const config = await this.currentConfig();

    const needsActivityTelemetryBackfill = options.forceActivityTelemetryBackfill === true || (config.activityTelemetryVersion || 0) < 2;
    const lastSyncMs = config.lastSyncTime ? new Date(config.lastSyncTime).getTime() : Number.NaN;
    const since = needsActivityTelemetryBackfill
      ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      : Number.isFinite(lastSyncMs)
        // Sobreposição curta para captar treinos que o relógio entregou com
        // atraso; a idempotência do backend impede duplicação.
        ? new Date(Math.max(Date.now() - 30 * 24 * 60 * 60 * 1000, lastSyncMs - 24 * 60 * 60 * 1000))
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const fontesConectadas: WearableSource[] = [
      ...(config.appleHealthConnected ? (['apple_health'] as const) : []),
      ...(config.healthConnectConnected ? (['health_connect'] as const) : [])
    ];

    if (fontesConectadas.length === 0) {
      throw new Error('Conecte o Apple Health ou o Health Connect para sincronizar.');
    }

    const atividades = [];
    let allProvidersReadSuccessfully = true;
    for (const fonte of fontesConectadas) {
      const provider = this.getProvider(fonte);
      if (!provider) continue;
      try {
        const lidas = await provider.fetchActivities(since);
        atividades.push(...lidas);
      } catch (err) {
        allProvidersReadSuccessfully = false;
        console.warn(`[WearableManager] Falha ao ler atividades de ${fonte}:`, err);
      }
    }

    const batches = atividades.length
      ? Array.from({ length: Math.ceil(atividades.length / 50) }, (_, index) => atividades.slice(index * 50, (index + 1) * 50))
      : [[]];
    let syncedCount = 0;
    let duplicatesSkipped = 0;
    let blockedCount = 0;
    let lastSyncTime: string | undefined;
    let telemetryVersion: number | undefined;
    const logs: WearableSyncLog[] = [];

    for (let index = 0; index < batches.length; index += 1) {
      this.assertUser(userId);
      if (atividades.some((activity) => !this.isProviderEnabledForUser(activity.source, userId))) throw new Error('A conexão de saúde foi desativada.');
      const response = await requestWithTimeout(wearablesEndpoint(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync',
          activities: batches[index],
          finalBatch: index === batches.length - 1,
          readComplete: allProvidersReadSuccessfully
        })
      });
      const payload = await response.json().catch(() => ({}));
      this.assertUser(userId);
      if (!response.ok) {
        throw new Error(payload?.error || 'Não foi possível sincronizar as atividades agora.');
      }

      syncedCount += Number(payload.syncedCount) || 0;
      duplicatesSkipped += Number(payload.duplicatesSkipped) || 0;
      blockedCount += Number(payload.blockedCount) || 0;
      lastSyncTime = typeof payload.lastSyncTime === 'string' ? payload.lastSyncTime : lastSyncTime;
      telemetryVersion = Number.isFinite(Number(payload.activityTelemetryVersion))
        ? Number(payload.activityTelemetryVersion)
        : telemetryVersion;

      if (Array.isArray(payload.logs)) {
        logs.push(...payload.logs.map((log: any) => ({
          id: log.sourceActivityId,
          userId: config.userId,
          provider: (atividades.find((a) => a.sourceActivityId === log.sourceActivityId)?.source || 'apple_health') as WearableSource,
          status: log.status === 'approved' ? 'success' : 'error',
          syncedCount: log.status === 'approved' ? 1 : 0,
          duplicatesSkipped: log.status === 'duplicate' ? 1 : 0,
          errorMessage: log.status !== 'approved' ? log.detalhe : undefined,
          timestamp: new Date().toISOString()
        })));
      }
    }

    if (this.config) {
      this.config.lastSyncTime = lastSyncTime || new Date().toISOString();
      if (telemetryVersion !== undefined) this.config.activityTelemetryVersion = telemetryVersion;
    }

    return {
      syncedCount,
      duplicatesSkipped,
      blockedCount,
      logs
    };
  }

  /**
   * Sincroniza métricas passivas de atividade, condicionamento e bem-estar via
   * @capgo/capacitor-health -- pipeline totalmente separado de syncAll()
   * acima. Vitais não passam pelo SecurityPipeline (não são uma alegação
   * competitiva: não geram pontos, não entram em ranking); vão direto pra
   * Health Data Layer. O campo legado quality continua existindo apenas por
   * compatibilidade; a confiança científica vem do Confidence Engine e da
   * proveniência preservada em cada leitura.
   *
   * A janela sobrepõe 24 horas ao cursor para absorver leituras que o relógio
   * entregou com atraso. IDs nativos tornam essa sobreposição idempotente.
   */
  public async syncVitals(options: { forceVitalsBackfill?: boolean } = {}): Promise<{ savedCount: number; diagnostics?: HealthVitalsDiagnostics }> {
    const userId = this.currentUserId();
    if (this.activeVitals?.userId === userId) return this.activeVitals.promise;
    const controller = new AbortController();
    const promise = this.performVitalsSync(options, userId, controller).finally(() => {
      if (this.activeVitals?.controller === controller) this.activeVitals = null;
    });
    this.activeVitals = { userId, controller, promise };
    return promise;
  }

  private async performVitalsSync(
    options: { forceVitalsBackfill?: boolean }, userId: string, controller: AbortController
  ): Promise<{ savedCount: number; diagnostics?: HealthVitalsDiagnostics }> {
    const config = await this.currentConfig();
    const source = Capacitor.getPlatform() === 'ios' ? 'apple_health' : 'health_connect';
    const assertContext = () => {
      this.assertUser(userId);
      if (controller.signal.aborted || !this.isProviderEnabledForUser(source, userId)) {
        throw new Error('A conexão de saúde foi desativada. Sincronização cancelada.');
      }
    };
    // Viewing Health never overrides the connection choice made in the profile.
    if (!this.isProviderEnabledForUser(source, userId)) return { savedCount: 0 };
    assertContext();
    if (!(await HealthVitalsProvider.isAvailable())) return { savedCount: 0 };
    assertContext();
    const permissions = await HealthVitalsProvider.checkPermissions();
    assertContext();
    const until = new Date();
    const sourceCursor = config.lastVitalsSyncBySource?.[source];
    const needsVitalsBackfill = options.forceVitalsBackfill === true || (config.healthVitalsVersionBySource?.[source] || 0) < 2 || !sourceCursor;
    const lastVitalsMs = sourceCursor ? new Date(sourceCursor).getTime() : Number.NaN;
    const since = !needsVitalsBackfill && Number.isFinite(lastVitalsMs)
      ? new Date(Math.max(until.getTime() - 30 * 86400000, lastVitalsMs - 24 * 3600000))
      : new Date(until.getTime() - 30 * 86400000);
    const { samples: vitals, diagnostics } = await HealthVitalsProvider.fetchVitalsWithDiagnostics(since, {
      until, signal: controller.signal, permissions
    });
    assertContext();
    const batches = vitals.length ? Array.from({ length: Math.ceil(vitals.length / 500) }, (_, index) => vitals.slice(index * 500, (index + 1) * 500)) : [[]];
    let savedCount = 0;
    let lastVitalsSyncTime: string | undefined;
    let healthVitalsVersion: number | undefined;
    // Empty and denied types are valid partial-permission states. Any actual
    // failed/truncated read retains the cursor so the next foreground sync retries.
    const readComplete = diagnostics.readComplete ?? diagnostics.failedTypes.length === 0;
    for (let index = 0; index < batches.length; index += 1) {
      const token = await this.getToken(userId);
      assertContext();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(wearablesEndpoint(), {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sync-vitals', source, vitals: batches[index], normalizationVersion: 2,
            syncWindowEnd: diagnostics.until, finalBatch: index === batches.length - 1, readComplete
          })
        });
        const payload = await response.json().catch(() => ({}));
        assertContext();
        if (!response.ok) throw new Error(payload?.error || 'Não foi possível sincronizar os dados de saúde agora.');
        if (Number(payload.rejectedCount) > 0) throw new Error('Algumas amostras foram recusadas; a sincronização permanece pendente.');
        savedCount += Number(payload.savedCount) || 0;
        if (typeof payload.lastVitalsSyncTime === 'string') lastVitalsSyncTime = payload.lastVitalsSyncTime;
        if (Number.isFinite(Number(payload.healthVitalsVersion))) healthVitalsVersion = Number(payload.healthVitalsVersion);
        if (this.config?.userId === userId && payload.lastVitalsSyncBySource) {
          this.config.lastVitalsSyncBySource = { ...this.config.lastVitalsSyncBySource, ...payload.lastVitalsSyncBySource };
        }
        if (this.config?.userId === userId && payload.healthVitalsVersionBySource) {
          this.config.healthVitalsVersionBySource = { ...this.config.healthVitalsVersionBySource, ...payload.healthVitalsVersionBySource };
        }
      } finally { clearTimeout(timer); }
    }
    assertContext();
    if (this.config?.userId === userId) {
      if (lastVitalsSyncTime) this.config.lastVitalsSyncTime = lastVitalsSyncTime;
      if (healthVitalsVersion !== undefined) this.config.healthVitalsVersion = healthVitalsVersion;
    }
    return { savedCount, diagnostics };
  }
}
