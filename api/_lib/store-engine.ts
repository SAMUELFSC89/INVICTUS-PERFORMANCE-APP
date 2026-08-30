import { db } from './common.js';
import { StoreItem, UserInventoryItem } from '../../src/types.js';

export const DEFAULT_STORE_ITEMS: StoreItem[] = [];

export class StoreEngine {
  /**
   * Fetches active store items.
   */
  static async getStoreItems(): Promise<StoreItem[]> {
    if (!db) return DEFAULT_STORE_ITEMS;
    try {
      const snap = await db.collection('store_items').where('active', '==', true).get();
      if (snap.empty) return DEFAULT_STORE_ITEMS;
      // Old prototypes were stored as active before the real catalogue existed.
      // Only an explicitly published product may appear in the public store.
      return snap.docs.map(doc => doc.data() as StoreItem & { published?: boolean }).filter(item => item.published === true);
    } catch (err) {
      console.warn('[StoreEngine] Error fetching store items from DB:', err);
      return DEFAULT_STORE_ITEMS;
    }
  }

  /**
   * Fetches user's purchased inventory items.
   */
  static async getUserInventory(userId: string): Promise<UserInventoryItem[]> {
    if (!db) return [];
    try {
      const snap = await db.collection('user_inventory').where('userId', '==', userId).get();
      return snap.docs.map(doc => doc.data() as UserInventoryItem);
    } catch (err) {
      console.warn('[StoreEngine] Error fetching user inventory:', err);
      return [];
    }
  }

  /**
   * Buys a store item using IV Coins.
   */
  static async buyItem(userId: string, itemId: string): Promise<{
    item: StoreItem;
    inventoryItem: UserInventoryItem;
  }> {
    if (!db) throw new Error('Database not initialized');

    // Purchases remain disabled until the physical catalogue, delivery rules
    // and RewardCoinEngine debit operation are approved.
    throw new Error('A Loja Invictus ainda não possui produtos disponíveis para resgate.');
    const items = await this.getStoreItems();
    const item = items.find(i => i.id === itemId);
    if (!item) throw new Error('Item de loja não encontrado.');

    if (item.stock !== undefined && item.stock <= 0) {
      throw new Error('Este item está esgotado no momento.');
    }

    // Check if user already owns non-consumable items (like theme/frame)
    const userInventory = await this.getUserInventory(userId);
    const alreadyOwns = userInventory.some(inv => inv.itemId === itemId && (item.category === 'frame' || item.category === 'theme' || item.category === 'avatar'));
    if (alreadyOwns) {
      throw new Error('Você já possui este item em seu inventário.');
    }

    // Add to inventory
    const inventoryId = `inv_${userId}_${itemId}_${Date.now()}`;
    const inventoryItem: UserInventoryItem = {
      id: inventoryId,
      userId,
      itemId,
      itemName: item.name,
      itemCategory: item.category,
      purchasedAt: new Date().toISOString()
    };

    await db.collection('user_inventory').doc(inventoryId).set(inventoryItem);

    // Decrease stock if limited
    if (item.stock !== undefined) {
      await db.collection('store_items').doc(itemId).set({
        stock: item.stock - 1
      }, { merge: true });
    }

    return { item, inventoryItem };
  }

  /**
   * Upserts a store item definition (for Admin).
   */
  static async upsertStoreItem(item: StoreItem): Promise<StoreItem> {
    if (!db) throw new Error('Database not initialized');
    await db.collection('store_items').doc(item.id).set(item, { merge: true });
    return item;
  }
}
