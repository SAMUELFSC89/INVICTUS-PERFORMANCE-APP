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
  'read_blood_glucose',
  'read_body_temperature',
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
  bloodPressure: 'read_blood_pressure', bloodGlucose: 'read_blood_glucose', bodyTemperature: 'read_body_temperature', bodyFat: 'read_body_composition',
  totalCalories: 'read_total_calories', exerciseTime: 'read_exercise_time', dietaryWater: 'read_hydration', mindfulness: 'read_mindfulness'
};

const wearablesEndpoint = () => `${API_CONFIG.baseUrl || ''}/api/wearables`;

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
  if (!snapshot) return [...READ_HEALTH_PERMISSIONS];
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

  private async getToken(): Promise<string> {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado');
    return user.getIdToken();
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
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : '',
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : ''
    };
  }

  private async requestConfig(method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<WearableConfig> {
    const user = auth.currentUser;
    const token = await this.getToken();
    const response = await fetch(wearablesEndpoint(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
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
    if (!user) return fallback;

    try {
      return await this.requestConfig('GET');
    } catch (err) {
      console.warn('[WearableManager] Usando configuração local de fallback:', err);
      if (this.config) return this.config;
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
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Provedor ${providerId} não registrado.`);

    const authorized = await provider.requestPermissions();
    if (!authorized) return false;

    // O provedor de atividades cobre treinos/rota/FC por sessão. O provedor
    // de vitais cobre sono, passos diários, FC de repouso, HRV e peso. Ambos
    // precisam ser autorizados no mesmo gesto explícito de conexão do usuário.
    let vitalsAuthorized = true;
    let confirmedHealthPermissions: string[] | undefined;
    if (providerId === 'apple_health' || providerId === 'health_connect') {
      vitalsAuthorized = await HealthVitalsProvider.requestPermissions();
      confirmedHealthPermissions = configuredPermissionsFromSnapshot(await HealthVitalsProvider.checkPermissions());
    }

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
    const config = this.config || (await this.loadConfig());
    if (!config.appleHealthConnected && !config.healthConnectConnected) return false;
    const authorized = await HealthVitalsProvider.requestPermissions();
    if (!authorized) return false;
    const confirmedPermissions = configuredPermissionsFromSnapshot(await HealthVitalsProvider.checkPermissions());
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
    const token = await this.getToken();
    const config = this.config || (await this.loadConfig());

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
      const response = await fetch(wearablesEndpoint(), {
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
    const available = await HealthVitalsProvider.isAvailable();
    if (!available) return { savedCount: 0 };

    const config = this.config || (await this.loadConfig());
    const needsVitalsBackfill = options.forceVitalsBackfill === true || (config.healthVitalsVersion || 0) < 1;
    const lastVitalsMs = config.lastVitalsSyncTime ? new Date(config.lastVitalsSyncTime).getTime() : Number.NaN;
    const since = !needsVitalsBackfill && Number.isFinite(lastVitalsMs)
      ? new Date(Math.max(Date.now() - 30 * 24 * 60 * 60 * 1000, lastVitalsMs - 24 * 60 * 60 * 1000))
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { samples: vitals, diagnostics } = await HealthVitalsProvider.fetchVitalsWithDiagnostics(since);
    const token = await this.getToken();
    const source: WearableSource = Capacitor.getPlatform() === 'ios' ? 'apple_health' : 'health_connect';
    const batches = vitals.length ? Array.from({ length: Math.ceil(vitals.length / 500) }, (_, index) => vitals.slice(index * 500, (index + 1) * 500)) : [[]];
    let savedCount = 0;
    let lastVitalsSyncTime: string | undefined;
    let healthVitalsVersion: number | undefined;
    const coreReadTypes = new Set(['heartRate', 'steps']);
    const readComplete = diagnostics.failedTypes.every((type) => !coreReadTypes.has(type))
      && diagnostics.emptyTypes.every((type) => !coreReadTypes.has(type));
    for (let index = 0; index < batches.length; index += 1) {
      const response = await fetch(wearablesEndpoint(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-vitals', source, vitals: batches[index], finalBatch: index === batches.length - 1, readComplete })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível sincronizar os dados de saúde agora.');
      savedCount += Number(payload.savedCount) || 0;
      if (typeof payload.lastVitalsSyncTime === 'string') lastVitalsSyncTime = payload.lastVitalsSyncTime;
      if (Number.isFinite(Number(payload.healthVitalsVersion))) healthVitalsVersion = Number(payload.healthVitalsVersion);
    }
    if (this.config) {
      if (lastVitalsSyncTime) this.config.lastVitalsSyncTime = lastVitalsSyncTime;
      if (healthVitalsVersion !== undefined) this.config.healthVitalsVersion = healthVitalsVersion;
    }
    return { savedCount, diagnostics };
  }
}
