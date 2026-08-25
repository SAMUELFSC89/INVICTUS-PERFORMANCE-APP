import { auth } from '../../firebase';
import { AppleHealthProvider } from './AppleHealthProvider';
import { HealthConnectProvider } from './HealthConnectProvider';
import { StravaProvider } from './StravaProvider';
import type { WearableConfig, WearableProvider, WearableSource, WearableSyncLog } from './types';

const READ_HEALTH_PERMISSIONS = [
  'read_heart_rate',
  'read_steps',
  'read_distance',
  'read_calories',
  'read_workouts'
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

  /** Carrega apenas o estado confirmado pelo servidor. */
  public async loadConfig(): Promise<WearableConfig> {
    return this.requestConfig('GET');
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
   * A leitura de Health/Apple permanece local, porém o endpoint seguro de
   * ingestão ainda não existe. Antes este método escrevia atividades,
   * biometria, score e desafios diretamente no Firestore; isso permitia que
   * o cliente homologasse dados. Falhamos de forma explícita até a API de
   * ingestão validada estar disponível.
   */
  public async syncAll(): Promise<{ syncedCount: number; duplicatesSkipped: number; logs: WearableSyncLog[] }> {
    await this.getToken();
    throw new Error('A sincronização de dispositivos está aguardando a ingestão segura no servidor. Nenhuma atividade ou pontuação foi criada localmente.');
  }
}
