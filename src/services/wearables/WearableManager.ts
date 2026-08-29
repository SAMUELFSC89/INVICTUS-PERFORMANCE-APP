import { Capacitor } from '@capacitor/core';
import { auth } from '../../firebase';
import { AppleHealthProvider } from './AppleHealthProvider';
import { HealthConnectProvider } from './HealthConnectProvider';
import { StravaProvider } from './StravaProvider';
import { HealthVitalsProvider } from './HealthVitalsProvider';
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
  'read_weight'
];

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
    autoSync: false,
    lastSyncTime: null,
    createdAt: '',
    updatedAt: ''
  };
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
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : '',
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : ''
    };
  }

  private async requestConfig(method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<WearableConfig> {
    const user = auth.currentUser;
    const token = await this.getToken();
    const response = await fetch('/api/wearables', {
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
    if (providerId === 'apple_health' || providerId === 'health_connect') {
      vitalsAuthorized = await HealthVitalsProvider.requestPermissions();
    }

    if (providerId === 'health_connect') {
      await this.updateConfig({
        healthConnectConnected: true,
        healthConnectPermissions: READ_HEALTH_PERMISSIONS
      });
    } else if (providerId === 'apple_health') {
      await this.updateConfig({
        appleHealthConnected: true,
        appleHealthPermissions: READ_HEALTH_PERMISSIONS
      });
    }

    if (vitalsAuthorized && (providerId === 'apple_health' || providerId === 'health_connect')) {
      // Primeira leitura logo após o consentimento: confirma acesso real e
      // evita uma conexão que aparece ativa mas nunca traz sono/passos/vitais.
      await this.syncVitals().catch((error) => console.warn('[WearableManager] Conectado, mas a primeira sincronização de vitais falhou:', error));
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
  public async syncAll(): Promise<{ syncedCount: number; duplicatesSkipped: number; blockedCount: number; logs: WearableSyncLog[] }> {
    const token = await this.getToken();
    const config = this.config || (await this.loadConfig());

    const since = config.lastSyncTime
      ? new Date(config.lastSyncTime)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // primeira sincronização: últimos 30 dias

    const fontesConectadas: WearableSource[] = [
      ...(config.appleHealthConnected ? (['apple_health'] as const) : []),
      ...(config.healthConnectConnected ? (['health_connect'] as const) : [])
    ];

    if (fontesConectadas.length === 0) {
      throw new Error('Conecte o Apple Health ou o Health Connect para sincronizar.');
    }

    const atividades = [];
    for (const fonte of fontesConectadas) {
      const provider = this.getProvider(fonte);
      if (!provider) continue;
      try {
        const lidas = await provider.fetchActivities(since);
        atividades.push(...lidas);
      } catch (err) {
        console.warn(`[WearableManager] Falha ao ler atividades de ${fonte}:`, err);
      }
    }

    if (atividades.length === 0) {
      return { syncedCount: 0, duplicatesSkipped: 0, blockedCount: 0, logs: [] };
    }

    const response = await fetch('/api/wearables', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync', activities: atividades })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Não foi possível sincronizar as atividades agora.');
    }

    if (this.config) this.config.lastSyncTime = payload.lastSyncTime || new Date().toISOString();

    const logs: WearableSyncLog[] = Array.isArray(payload.logs)
      ? payload.logs.map((log: any) => ({
          id: log.sourceActivityId,
          userId: config.userId,
          provider: (atividades.find((a) => a.sourceActivityId === log.sourceActivityId)?.source || 'apple_health') as WearableSource,
          status: log.status === 'approved' ? 'success' : 'error',
          syncedCount: log.status === 'approved' ? 1 : 0,
          duplicatesSkipped: log.status === 'duplicate' ? 1 : 0,
          errorMessage: log.status !== 'approved' ? log.detalhe : undefined,
          timestamp: new Date().toISOString()
        }))
      : [];

    return {
      syncedCount: payload.syncedCount || 0,
      duplicatesSkipped: payload.duplicatesSkipped || 0,
      blockedCount: payload.blockedCount || 0,
      logs
    };
  }

  /**
   * #253: sincroniza METRICAS PASSIVAS (FC repouso, HRV, sono, peso) via
   * @capgo/capacitor-health -- pipeline totalmente separado de syncAll()
   * acima. Vitais não passam pelo SecurityPipeline (não são uma alegação
   * competitiva: não geram pontos, não entram em ranking); vão direto pra
   * Health Data Layer com quality='sensor_verified'.
   *
   * Sem `lastVitalsSyncTime` persistido ainda de propósito -- essa sincronia
   * ainda não tem nenhuma tela consumidora (tela "Saúde" fica pra depois,
   * ver #53); adicionar rastreio de cursor no servidor agora seria expandir
   * schema pra uma leitura que ninguém dispara automaticamente. Usa uma
   * janela fixa de 30 dias por chamada -- reprocessar o mesmo período em
   * chamadas futuras é seguro (grava com merge, doc id determinístico por
   * timestamp, não duplica a série).
   */
  public async syncVitals(): Promise<{ savedCount: number }> {
    const available = await HealthVitalsProvider.isAvailable();
    if (!available) return { savedCount: 0 };

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const vitals = await HealthVitalsProvider.fetchVitals(since);
    if (vitals.length === 0) return { savedCount: 0 };

    const token = await this.getToken();
    const source: WearableSource = Capacitor.getPlatform() === 'ios' ? 'apple_health' : 'health_connect';
    const response = await fetch('/api/wearables', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync-vitals', source, vitals })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Não foi possível sincronizar os dados de saúde agora.');
    }
    return { savedCount: payload.savedCount || 0 };
  }
}
