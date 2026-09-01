import { auth } from '../firebase';
import { API_CONFIG } from '../config';

export interface InvictusAiMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  timestamp: string;
  confidence?: string;
  sources?: string[];
}

interface AskInput {
  queryText: string;
  history: InvictusAiMessage[];
  userProfile: Record<string, unknown>;
}

export const invictusAiService = {
  async ask({ queryText, history, userProfile }: AskInput) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Sua sessão expirou. Entre novamente para falar com a Invictus IA.');
    const token = await currentUser.getIdToken();
    const response = await fetch(`${API_CONFIG.baseUrl}/api/performance-ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        queryText,
        history: history.slice(-6).map(({ sender, text }) => ({ sender, text })),
        userProfile,
        screenName: 'Invictus IA',
        currentPath: '/ai',
        includeAudio: false,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload.answer !== 'string') {
      throw new Error(payload.error || 'A Invictus IA não respondeu. Tente novamente.');
    }
    return payload as { answer: string; confidence?: string; sources?: string[] };
  },
};
