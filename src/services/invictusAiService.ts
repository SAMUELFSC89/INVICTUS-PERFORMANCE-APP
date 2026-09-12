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

const AI_REQUEST_TIMEOUT_MS = 45_000;

export const invictusAiService = {
  async ask({ queryText, history, userProfile }: AskInput) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Sua sessão expirou. Entre novamente para falar com a Invictus IA.');
    const expectedUid = currentUser.uid;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

    try {
      const token = await currentUser.getIdToken();
      if (auth.currentUser?.uid !== expectedUid) {
        throw new Error('A conta mudou durante a consulta. Envie a pergunta novamente na conta atual.');
      }
      const response = await fetch(`${API_CONFIG.baseUrl}/api/performance-ai`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          queryText,
          // history contains only turns completed before queryText. The current
          // question is sent separately and must never be duplicated in context.
          history: history.slice(-6).map(({ sender, text }) => ({ sender, text })),
          userProfile,
          screenName: 'Invictus IA',
          currentPath: '/ai',
          includeAudio: false,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (auth.currentUser?.uid !== expectedUid) {
        throw new Error('A conta mudou durante a consulta. Envie a pergunta novamente na conta atual.');
      }
      if (!response.ok || typeof payload.answer !== 'string') {
        throw new Error(payload.error || 'A Invictus IA não respondeu. Tente novamente.');
      }
      return payload as { answer: string; confidence?: string; sources?: string[] };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('A Invictus IA demorou mais que o esperado. Tente novamente.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  },
};