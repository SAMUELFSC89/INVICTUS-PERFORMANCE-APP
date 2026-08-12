import { db } from './common.js';
import { ConversionConfig } from '../../src/types.js';

export const DEFAULT_CONVERSION_CONFIG: ConversionConfig = {
  coinsPerBrl: 100, // 100 IV Coins = R$ 1,00
  minWithdrawalCoins: 500, // R$ 5,00
  maxDailyWithdrawalCoins: 50000, // R$ 500,00
  enabled: true,
  updatedAt: new Date().toISOString()
};

export class ConversionEngine {
  /**
   * Fetches the current conversion configuration from database.
   * If not set yet, returns default config.
   */
  static async getConfig(): Promise<ConversionConfig> {
    try {
      if (!db) return DEFAULT_CONVERSION_CONFIG;
      const docRef = db.collection('system_config').doc('conversion');
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        const data = docSnap.data() as Partial<ConversionConfig>;
        return {
          coinsPerBrl: Number(data.coinsPerBrl) || DEFAULT_CONVERSION_CONFIG.coinsPerBrl,
          minWithdrawalCoins: Number(data.minWithdrawalCoins) || DEFAULT_CONVERSION_CONFIG.minWithdrawalCoins,
          maxDailyWithdrawalCoins: Number(data.maxDailyWithdrawalCoins) || DEFAULT_CONVERSION_CONFIG.maxDailyWithdrawalCoins,
          enabled: data.enabled !== undefined ? Boolean(data.enabled) : DEFAULT_CONVERSION_CONFIG.enabled,
          updatedAt: data.updatedAt || new Date().toISOString()
        };
      }
    } catch (err) {
      console.warn('[ConversionEngine] Error fetching conversion config from DB, using fallback defaults:', err);
    }
    return DEFAULT_CONVERSION_CONFIG;
  }

  /**
   * Updates conversion configuration in database.
   */
  static async updateConfig(newConfig: Partial<ConversionConfig>): Promise<ConversionConfig> {
    if (!db) throw new Error('Database not initialized');
    const current = await this.getConfig();
    const updated: ConversionConfig = {
      coinsPerBrl: newConfig.coinsPerBrl ? Number(newConfig.coinsPerBrl) : current.coinsPerBrl,
      minWithdrawalCoins: newConfig.minWithdrawalCoins ? Number(newConfig.minWithdrawalCoins) : current.minWithdrawalCoins,
      maxDailyWithdrawalCoins: newConfig.maxDailyWithdrawalCoins ? Number(newConfig.maxDailyWithdrawalCoins) : current.maxDailyWithdrawalCoins,
      enabled: newConfig.enabled !== undefined ? Boolean(newConfig.enabled) : current.enabled,
      updatedAt: new Date().toISOString()
    };

    await db.collection('system_config').doc('conversion').set(updated, { merge: true });
    return updated;
  }

  /**
   * Converts IV Coins to BRL (reais).
   */
  static coinsToBrl(coinsAmount: number, rate: number = 100): number {
    if (!coinsAmount || coinsAmount <= 0) return 0;
    return Number((coinsAmount / rate).toFixed(2));
  }

  /**
   * Converts BRL to IV Coins.
   */
  static brlToCoins(brlAmount: number, rate: number = 100): number {
    if (!brlAmount || brlAmount <= 0) return 0;
    return Math.floor(brlAmount * rate);
  }
}
