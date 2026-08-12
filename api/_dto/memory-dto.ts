export type MemoryCategory =
  | 'profile'
  | 'goal'
  | 'preference'
  | 'routine'
  | 'training'
  | 'progress'
  | 'achievement'
  | 'difficulty'
  | 'behavior'
  | 'strategy'
  | 'communication';

export interface UserMemory {
  id?: string;
  userId: string;
  content: string;
  category: MemoryCategory;
  importance: number; // 0.0 to 1.0
  confidence: number; // 0.0 to 1.0
  source: 'conversation' | 'activity' | 'system' | 'user_explicit';
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface CreateMemoryDTO {
  userId: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  confidence: number;
  source?: 'conversation' | 'activity' | 'system' | 'user_explicit';
}

export interface UpdateMemoryDTO {
  content?: string;
  category?: MemoryCategory;
  importance?: number;
  confidence?: number;
  lastUsedAt?: string;
}

export interface ExtractMemoriesRequest {
  userId: string;
  userMessage: string;
  aiResponse: string;
  currentMemories?: UserMemory[];
}

export interface ExtractedMemoryItem {
  action: 'create' | 'update' | 'none';
  existingMemoryId?: string;
  category: MemoryCategory;
  content: string;
  importance: number;
  confidence: number;
  reasoning: string;
}
