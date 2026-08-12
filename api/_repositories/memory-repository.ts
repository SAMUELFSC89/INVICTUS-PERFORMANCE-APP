import { BaseRepository } from './base-repository.js';
import { UserMemory, MemoryCategory } from '../_dto/memory-dto.js';
import { db } from '../_lib/common.js';

export class MemoryRepository extends BaseRepository<UserMemory> {
  constructor() {
    super('invictus_user_memories');
  }

  async getByUserId(userId: string, category?: MemoryCategory, limitNum = 30): Promise<UserMemory[]> {
    if (!userId) return [];

    let query: any = this.collection.where('userId', '==', userId);

    if (category) {
      query = query.where('category', '==', category);
    }

    // Retrieve and sort in memory by importance / updatedAt to avoid needing complex Firestore composite indexes
    const snapshot = await query.get();
    const memories: UserMemory[] = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));

    return memories
      .sort((a, b) => {
        // High importance first, then newest
        if (b.importance !== a.importance) {
          return b.importance - a.importance;
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, limitNum);
  }

  async getRelevantMemoriesForQuery(userId: string, queryText: string, limitNum = 15): Promise<UserMemory[]> {
    const allMemories = await this.getByUserId(userId, undefined, 50);
    if (allMemories.length === 0) return [];

    const normalizedQuery = queryText.toLowerCase().trim();
    const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);

    // Score memories based on keyword match, importance, and category relevance
    const scored = allMemories.map(mem => {
      let score = mem.importance || 0.5;
      const memText = (mem.content || '').toLowerCase();
      const category = mem.category || 'preference';

      // Always give boost to profile & primary goals
      if (category === 'goal' || category === 'profile') {
        score += 0.3;
      }

      // Check keyword intersection
      let keywordHits = 0;
      for (const word of queryWords) {
        if (memText.includes(word)) {
          keywordHits++;
        }
      }

      if (queryWords.length > 0) {
        score += (keywordHits / queryWords.length) * 0.5;
      }

      return { mem, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limitNum)
      .map(s => s.mem);
  }

  async touchLastUsed(memoryIds: string[]): Promise<void> {
    if (!memoryIds || memoryIds.length === 0) return;
    const now = new Date().toISOString();
    const batch = db.batch();

    memoryIds.forEach(id => {
      if (id) {
        const ref = this.collection.doc(id);
        batch.update(ref, { lastUsedAt: now });
      }
    });

    await batch.commit().catch(err => console.warn('[MemoryRepo] Touch error:', err));
  }

  async deleteUserMemory(id: string, userId: string): Promise<boolean> {
    const memory = await this.findById(id);
    if (!memory) return false;
    if (memory.userId !== userId) {
      throw new Error('Acesso negado. A memória pertence a outro usuário.');
    }
    await this.delete(id);
    return true;
  }
}
