import { GoogleGenAI, Type } from '@google/genai';
import { MemoryRepository } from '../../_repositories/memory-repository.js';
import { UserMemory, CreateMemoryDTO, MemoryCategory } from '../../_dto/memory-dto.js';
import { getAiApiKey, getAiMemoryExtractionModel } from '../../_lib/ai-config.js';
import { extractUsage, logAiUsage, newAiRequestId } from '../../_lib/ai-usage-logger.js';

// #AI_COST_AUDIT: antes desta mudança, TODA mensagem do chat (mesmo "oi",
// "valeu", "beleza") disparava uma segunda chamada Gemini completa só para
// checar se havia algo memorável -- dobrando o número de requests do
// recurso mais usado do app, no mesmo modelo caro do chat (não um modelo
// econômico, apesar de ser uma classificação simples). O filtro abaixo evita
// a chamada quando a mensagem claramente não carrega informação duradoura,
// sem arriscar perder uma memória real: qualquer mensagem fora da lista de
// saudações/confirmações comuns ou mais longa que o limiar ainda passa
// normalmente pela extração via IA.
// Mensagens curtas ainda podem ser um dado real ("2x/semana", "joelho D"), por
// isso o filtro NÃO é por tamanho -- só reconhece saudações/confirmações
// exatas conhecidas. Qualquer coisa fora dessa lista, mesmo curta, segue
// normalmente para a extração via IA.
const TRIVIAL_MESSAGE_PATTERNS = [
  /^oi+!?$/, /^ol[aá]!?$/, /^e\s*a[ií]!?$/, /^bom\s*dia!?$/, /^boa\s*tarde!?$/, /^boa\s*noite!?$/,
  /^obrigad[oa]!?$/, /^vlw!?$/, /^valeu!?$/, /^bl?z!?$/, /^beleza!?$/, /^show!?$/, /^top!?$/,
  /^ok(ay)?!?$/, /^certo!?$/, /^entendi!?$/, /^perfeito!?$/, /^legal!?$/, /^massa!?$/,
  /^sim!?$/, /^n[aã]o!?$/, /^de nada!?$/, /^tchau!?$/, /^at[eé]\s*mais!?$/, /^flw!?$/,
  /^👍+$/, /^🙏+$/, /^😊+$/, /^❤️+$/
];

export function isTrivialMessage(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return TRIVIAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Contexto suficiente para a extração sem reenviar a resposta inteira da IA. */
const MAX_AI_RESPONSE_CHARS_FOR_EXTRACTION = 600;

export class MemoryService {
  constructor(private memoryRepo: MemoryRepository) {}

  /**
   * Retrieves relevant memories formatted for AI context prompt.
   * Ensures absolute isolation per userId.
   */
  async getFormattedMemoriesForContext(userId: string, userQuery: string): Promise<{
    formattedContext: string;
    memoriesList: UserMemory[];
  }> {
    if (!userId) {
      return { formattedContext: '', memoriesList: [] };
    }

    const memories = await this.memoryRepo.getRelevantMemoriesForQuery(userId, userQuery, 12);
    
    // Filter importance >= 0.4 per rule #5
    const validMemories = memories.filter(m => (m.importance ?? 0.5) >= 0.4);

    if (validMemories.length === 0) {
      return { formattedContext: '', memoriesList: [] };
    }

    // Touch lastUsedAt asynchronously
    const ids = validMemories.map(m => m.id!).filter(Boolean);
    this.memoryRepo.touchLastUsed(ids).catch(() => {});

    const lines = validMemories.map(m => 
      `- [${(m.category || 'preference').toUpperCase()}] (Relevância: ${m.importance || 0.8}): ${m.content}`
    );

    const formattedContext = `
# MEMÓRIAS PERSISTENTES DO ATLETA (VINCULADAS AO USERID: ${userId})
*As informações abaixo foram aprendidas em conversas anteriores. Utilize-as para personalizar suas orientações com naturalidade sem citar que possui um banco de dados de memória:*

${lines.join('\n')}
`;

    return { formattedContext, memoriesList: validMemories };
  }

  /**
   * Creates or updates a memory avoiding duplicates (Rule #6 & #7).
   */
  async saveOrUpdateMemory(userId: string, data: CreateMemoryDTO): Promise<UserMemory | null> {
    if (!userId || !data.content || data.content.trim().length === 0) return null;

    // Reject low importance memories per rule #5
    if (data.importance < 0.4) {
      return null;
    }

    const category = data.category || 'preference';
    const cleanContent = data.content.trim();

    // Fetch existing memories for this user in this category or all
    const existing = await this.memoryRepo.getByUserId(userId, category, 30);

    // Look for duplicate or semantic overlap
    const contentLower = cleanContent.toLowerCase();
    const existingMatch = existing.find(m => {
      const existingLower = m.content.toLowerCase();
      return (
        existingLower === contentLower ||
        existingLower.includes(contentLower) ||
        contentLower.includes(existingLower)
      );
    });

    const now = new Date().toISOString();

    if (existingMatch && existingMatch.id) {
      // Rule #6 & #7: Update existing memory instead of creating duplicate
      await this.memoryRepo.update(existingMatch.id, {
        content: cleanContent,
        importance: Math.max(existingMatch.importance || 0.5, data.importance),
        confidence: data.confidence || existingMatch.confidence || 0.9,
        lastUsedAt: now
      });

      return {
        ...existingMatch,
        content: cleanContent,
        importance: Math.max(existingMatch.importance || 0.5, data.importance),
        updatedAt: now
      };
    } else {
      // Create new memory
      const newMemory: Omit<UserMemory, 'id'> = {
        userId,
        content: cleanContent,
        category,
        importance: Number(data.importance.toFixed(2)),
        confidence: Number((data.confidence || 0.95).toFixed(2)),
        source: data.source || 'conversation',
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now
      };

      return await this.memoryRepo.create(newMemory);
    }
  }

  /**
   * Silently extracts persistent memory candidates from a user interaction using Gemini.
   * Follows Rules 2, 3, 4, 5, 6, 7 & 10.
   */
  async extractAndStoreMemoriesFromInteraction(
    userId: string,
    userMessage: string,
    aiResponse: string
  ): Promise<void> {
    if (!userId || !userMessage || userMessage.trim().length < 5) return;
    // #AI_COST_AUDIT: saudações/confirmações não carregam memória duradoura --
    // não vale a pena gastar uma chamada Gemini inteira só para descobrir isso.
    if (isTrivialMessage(userMessage)) return;

    const requestId = newAiRequestId();
    const startedAt = Date.now();
    // #AI_COST_AUDIT: extração de memória é classificação estruturada em
    // segundo plano (não a resposta do chat) -- roda no tier Flash-Lite, mais
    // barato, sem prejuízo de qualidade percebida pelo atleta.
    const model = getAiMemoryExtractionModel();

    try {
      const apiKey = getAiApiKey();
      if (!apiKey) return;

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      // A resposta completa da IA pode ser longa (análises detalhadas); para
      // decidir o que vale memorizar, o começo já basta -- reenviar o texto
      // inteiro só infla o input sem melhorar a extração.
      const truncatedAiResponse = aiResponse.length > MAX_AI_RESPONSE_CHARS_FOR_EXTRACTION
        ? `${aiResponse.slice(0, MAX_AI_RESPONSE_CHARS_FOR_EXTRACTION)}…`
        : aiResponse;

      const extractionPrompt = `
Você é o módulo de Análise de Memória Persistente do Invictus IA.
Analise a mensagem do usuário e determine se ela contém informações duradouras que devam ser salvas como memória individual do atleta.

# REGRAS RÍGIDAS DE EXTRAÇÃO:
1. NÃO SALVE estados temporários ("Estou cansado hoje", "Vou treinar tarde hoje").
2. SALVE preferências, objetivos, limitações, rotinas fixas, equipamentos, conquistas ou mudanças duradouras ("Só consigo treinar 2ª, 4ª e 6ª", "Meu objetivo principal é hipertrofia", "Tenho condromalácia no joelho direito").
3. Classifique em uma das categorias permitidas:
   profile, goal, preference, routine, training, progress, achievement, difficulty, behavior, strategy, communication
4. Atribua importância entre 0.4 e 1.0 (se for menor que 0.4, não extraia).
5. Se a mensagem não contiver nada relevante para armazenamento duradouro, retorne uma lista vazia.

Mensagem do Usuário: "${userMessage}"
Resposta da IA: "${truncatedAiResponse}"
`;

      const schema = {
        type: Type.OBJECT,
        properties: {
          memoriesToSave: {
            type: Type.ARRAY,
            description: 'Lista de memórias duradouras extraídas da conversa',
            items: {
              type: Type.OBJECT,
              properties: {
                content: { type: Type.STRING, description: 'Descrição objetiva e concisa da memória em 3ª pessoa. Ex: Usuário prefere treinar pela manhã.' },
                category: { 
                  type: Type.STRING, 
                  description: 'Categoria da memória',
                  enum: ['profile', 'goal', 'preference', 'routine', 'training', 'progress', 'achievement', 'difficulty', 'behavior', 'strategy', 'communication']
                },
                importance: { type: Type.NUMBER, description: 'Grau de importância entre 0.4 e 1.0' },
                confidence: { type: Type.NUMBER, description: 'Grau de confiança da informação entre 0.5 e 1.0' }
              },
              required: ['content', 'category', 'importance', 'confidence']
            }
          }
        },
        required: ['memoriesToSave']
      };

      const result = await ai.models.generateContent({
        model,
        contents: extractionPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        }
      });

      logAiUsage({
        requestId,
        userId,
        feature: 'MEMORY_EXTRACTION',
        model,
        ...extractUsage(result),
        durationMs: Date.now() - startedAt,
        success: true,
        contextSize: extractionPrompt.length
      }).catch(() => {});

      const rawText = result.text;
      if (!rawText) return;

      const parsed = JSON.parse(rawText);
      if (parsed && Array.isArray(parsed.memoriesToSave) && parsed.memoriesToSave.length > 0) {
        for (const item of parsed.memoriesToSave) {
          if (item.content && item.importance >= 0.4) {
            await this.saveOrUpdateMemory(userId, {
              userId,
              content: item.content,
              category: item.category as MemoryCategory,
              importance: item.importance,
              confidence: item.confidence,
              source: 'conversation'
            });
          }
        }
      }
    } catch (err) {
      logAiUsage({
        requestId,
        userId,
        feature: 'MEMORY_EXTRACTION',
        model,
        durationMs: Date.now() - startedAt,
        success: false,
        errorCode: err instanceof Error ? err.message.slice(0, 200) : 'unknown_error'
      }).catch(() => {});
      console.warn('[MemoryService] Silent extraction error:', err);
    }
  }

  async getUserMemories(userId: string): Promise<UserMemory[]> {
    if (!userId) return [];
    return await this.memoryRepo.getByUserId(userId, undefined, 50);
  }

  async deleteMemory(memoryId: string, userId: string): Promise<boolean> {
    if (!memoryId || !userId) return false;
    return await this.memoryRepo.deleteUserMemory(memoryId, userId);
  }
}
