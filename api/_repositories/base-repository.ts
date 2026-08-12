import { db } from '../_lib/common.js';

export abstract class BaseRepository<T extends { id?: string }> {
  constructor(protected collectionName: string) {}

  protected get collection() {
    return db.collection(this.collectionName);
  }

  async findById(id: string): Promise<T | null> {
    const doc = await this.collection.doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as T;
  }

  async create(data: Omit<T, 'id'>, customId?: string): Promise<T> {
    const now = new Date().toISOString();
    const payload = {
      ...data,
      createdAt: (data as any).createdAt || now,
      updatedAt: now
    };

    if (customId) {
      await this.collection.doc(customId).set(payload);
      return { id: customId, ...payload } as unknown as T;
    }
    const docRef = await this.collection.add(payload);
    return { id: docRef.id, ...payload } as unknown as T;
  }

  async update(id: string, data: Partial<T>): Promise<void> {
    await this.collection.doc(id).update({
      ...data,
      updatedAt: new Date().toISOString()
    });
  }

  async delete(id: string): Promise<void> {
    await this.collection.doc(id).delete();
  }
}
