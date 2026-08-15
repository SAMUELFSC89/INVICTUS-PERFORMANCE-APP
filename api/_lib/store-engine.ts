import { db } from './common.js';
import { WalletEngine } from './wallet-engine.js';
import { StoreItem, UserInventoryItem } from '../../src/types.js';

export const DEFAULT_STORE_ITEMS: StoreItem[] = [
  {
    id: 'store_frame_gold',
    name: 'Moldura Ouro Lendária',
    description: 'Moldura dourada animada com brilho reluzente para o seu avatar de perfil.',
    category: 'frame',
    iconUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
    priceCoins: 300,
    priceCategory: 'any',
    active: true
  },
  {
    id: 'store_avatar_cyber_spartan',
    name: 'Avatar Espartano Cyber',
    description: 'Avatar exclusivo da coleção Cyber Spartan de alta resolução.',
    category: 'avatar',
    iconUrl: 'https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=120&auto=format&fit=crop&q=80',
    priceCoins: 500,
    priceCategory: 'any',
    active: true
  },
  {
    id: 'store_theme_neon_dark',
    name: 'Tema Neon Emerald Invictus',
    description: 'Tema personalizado dark mode com acentos esmeralda para a interface.',
    category: 'theme',
    iconUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=120&auto=format&fit=crop&q=80',
    priceCoins: 400,
    priceCategory: 'any',
    active: true
  },
  {
    id: 'store_event_ticket_championship',
    name: 'Ticket de Inscrição VIP Campeonato',
    description: 'Garante entrada no próximo grande campeonato de ligas com premiação em dinheiro.',
    category: 'ticket',
    iconUrl: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=120&auto=format&fit=crop&q=80',
    priceCoins: 1000,
    priceCategory: 'any',
    active: true
  }
];

export class StoreEngine {
  /**
   * Fetches active store items.
   */
  static async getStoreItems(): Promise<StoreItem[]> {
    if (!db) return DEFAULT_STORE_ITEMS;
    try {
      const snap = await db.collection('store_items').where('active', '==', true).get();
      if (snap.empty) {
        for (const item of DEFAULT_STORE_ITEMS) {
          await db.collection('store_items').doc(item.id).set(item);
        }
        return DEFAULT_STORE_ITEMS;
      }
      return snap.docs.map(doc => doc.data() as StoreItem);
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

    // TODO(loja-invictus): sistema ainda nao foi lancado aos usuarios (nenhuma
    // rota do frontend chama este endpoint hoje). Os valores em 'priceCoins' nos
    // itens de DEFAULT_STORE_ITEMS sao um resquicio do antigo sistema de moedas
    // (IV Coins), anterior a migracao do WalletEngine para saldo real em R$
    // (ver tasks #119/#120). Bloqueado de proposito ate os precos serem
    // revisados em R$ reais - do contrario, debitCoins() cobraria R$300-R$1000
    // reais de verdade por um item cosmetico. Remover este guard somente depois
    // de revisar priceCoins/priceCategory para valores reais e religar a rota.
    throw new Error('Loja Invictus ainda nao esta disponivel para compra (precos pendentes de revisao em R$ real).');
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

    // Debit IV Coins from user's wallet
    await WalletEngine.debitCoins({
      userId,
      amount: item.priceCoins,
      category: item.priceCategory,
      origin: 'store_purchase',
      description: `Compra na Loja Invictus: ${item.name}`,
      destination: `Loja Invictus`
    });

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
