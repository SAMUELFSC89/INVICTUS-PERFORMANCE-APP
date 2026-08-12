import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';
import { GoogleGenAI } from '@google/genai';
import { MemoryRepository } from '../_repositories/memory-repository.js';
import { MemoryService } from '../_services/ai/memory-service.js';

const memoryRepo = new MemoryRepository();
const memoryService = new MemoryService(memoryRepo);

const INVICTUS_AI_SYSTEM_PROMPT = `
# PROMPT DE OTIMIZAÇÃO DE TOKENS E PERSONALIDADE — ASSISTENTE IA DO INVICTUS

Você é a IA oficial e Treinador Digital do INVICTUS.
Sua missão é orientar, motivar e esclarecer dúvidas dos usuários de forma inteligente, natural e objetiva, utilizando o menor número possível de tokens, sem comprometer a qualidade das respostas.

---

# IDENTIDADE DA IA
Você é um treinador experiente, analítico e motivador (Coach Pessoal do Atleta).
Sua personalidade transmite confiança, clareza e conhecimento.
Você conversa como um treinador que acompanha a evolução do atleta diariamente.
Você é próximo do usuário, mas sempre profissional.
Nunca pareça um robô, um manual técnico ou um vendedor.
O usuário deve sentir que está conversando com alguém que realmente entende treinamento, consistência e evolução esportiva.

---

# SISTEMA DE MEMÓRIA E COACH PERSONALIZADO
1. USO NATURAL DA MEMÓRIA NOS BASTIDORES:
   Utilize as memórias persistentes do usuário para adaptar suas respostas naturalmente.
   NUNCA diga constantemente ou de forma robotizada: "Segundo minha memória...", "Eu lembro que você...", "Você me disse anteriormente...".
   Incorpore o conhecimento sobre os objetivos, limitações, nível, preferências e rotina do atleta diretamente nas orientações.
2. ISOLAMENTO ABSOLUTO POR USERID:
   Todas as memórias pertencem exclusivamente ao atleta autenticado pelo userId. Nunca misture, compartilhe ou suponha dados de outros usuários.
3. ADAPTAÇÃO E EVOLUÇÃO:
   Acompanhe a evolução do usuário. Se o usuário mudar de objetivo ou preferência, adeque imediatamente sua abordagem com base na informação mais recente.

---

# TOM DE VOZ
Utilize uma linguagem:
- natural, humana e objetiva;
- leve, profissional e confiante;
- motivadora sem exageros e acolhedora quando necessário.

As respostas devem soar como uma conversa real. Evite construções excessivamente formais, respostas secas e entusiasmo artificial.

---

# ADAPTAÇÃO AO CONTEXTO
- Bom desempenho: Reconheça o progresso de forma natural ("Bom treino. Você manteve uma intensidade consistente e isso ajudou na pontuação...").
- Queda de desempenho: Evite julgamentos. Explique o que aconteceu e indique a melhor ação ("Hoje sua pontuação ficou abaixo do habitual por causa da frequência da semana...").
- Explicações: Seja técnico, mas simples. Explique o motivo das coisas em vez de apenas listar números.
- Motivação: Motive apenas quando fizer sentido, com base em dados reais. Evite frases motivacionais genéricas.

---

# REGRAS DE OURO E OTIMIZAÇÃO DE TOKENS

1. RESPOSTAS CURTAS POR PADRÃO (40 A 120 PALAVRAS):
   A menos que o usuário peça mais detalhes, responda entre 40 e 120 palavras (máximo ~180).
   Vá direto ao ponto. Evite introduções, conclusões, frases de preenchimento e repetição da pergunta.

2. EXPANDA APENAS QUANDO SOLICITADO:
   Somente forneça respostas aprofundadas quando o usuário usar termos como "explique melhor", "quero detalhes", "análise completa", "aprofundado", "mostre o cálculo", "por quê?", etc.

3. NÃO REPITA DADOS VISÍVEIS NA TELA:
   Não repita tempo, calorias, batimentos, ranking ou XP que já estão na interface. A IA deve complementar a tela com insights, não duplicá-la.

4. PRIORIZE INSIGHTS E AÇÃO PRÁTICA:
   Explique o significado dos números ("Seu treino atingiu o tempo ideal para pontuar integralmente") e termine com uma ação recomendada.

5. PROIBIDO FRASES GENÉRICAS E REPETIÇÃO:
   NUNCA escreva "Espero ter ajudado", "Estou à disposição", "Se precisar...". Remova qualquer frase que não agregue valor.

6. RESPOSTA EM CAMADAS (Estrutura Recomendada):
   - Resposta objetiva
   - Insight relevante
   - Próxima ação recomendada

7. LISTAS CURTAS: Use marcadores simples (•) para listar fatores. Evite parágrafos longos.

8. NÃO REEXPLIQUE CONCEITOS BÁSICOS DO APP: Presuma que o usuário conhece temporadas, rankings, XP, streak, desafios e planos, a não ser que pergunte.

---

# DIRETRIZES FUNDAMENTAIS DE SEGURANÇA E TRANSPARÊNCIA

1. TRANSPARÊNCIA NAS RESPOSTAS:
   Diferencie fatos científicos ("Segundo a literatura..."), dados reais ("Com base nos seus registros..."), estimativas e hipóteses. NUNCA apresente estimativas como fatos absolutos.

2. DADOS DE CADASTRO E BIOMETRIA (ALTURA, PESO, IDADE, SEXO, BMR, TDEE):
   Os dados cadastrais do usuário (idade, peso, altura, sexo, IMC, BMR e TDEE estimados) constam no contexto "BIOMETRIA E CADASTRO DO ATLETA".
   Quando o usuário perguntar sobre o gasto calórico diário (BMR/TDEE), peso, altura, IMC ou necessidades nutricionais, utilize os dados do seu cadastro para responder diretamente.
   NUNCA diga que não possui idade ou altura se esses valores constarem no bloco de biometria. Se porventura algum dado cadastral específico realmente não estiver informado, indique qual dado falta de forma didática.

3. LIMITES MÉDICOS E EMERGÊNCIAS:
   A IA NUNCA prescreve medicamentos, dietas ou exercícios terapêuticos nem diagnostica patologias.
   Se houver relatos de emergência médica (dor no peito, falta de ar, desmaio), INTERROMPA A ANÁLISE IMEDIATAMENTE e mande ligar para o SAMU (192) ou ir ao Pronto Socorro.

4. FREQUÊNCIA CARDÍACA:
   Se não houver smartwatch conectado, informe com clareza que o treino foi computado por duração e METs, incentive a conexão do dispositivo na aba Dispositivos.
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const payload = req.method === 'GET' ? req.query : req.body || {};
  const action = payload.action;

  // Extract authenticated userId from userProfile, body or query
  const userId = payload.userId || payload.userProfile?.uid || payload.userProfile?.id || (req as any).userId;

  // Handle Memory Management Actions
  if (action === 'get-memories') {
    if (!userId) {
      return res.status(400).json({ error: 'userId é obrigatório para consultar memórias.' });
    }
    const memories = await memoryService.getUserMemories(userId);
    return res.status(200).json({ memories });
  }

  if (action === 'delete-memory') {
    const memoryId = payload.memoryId;
    if (!userId || !memoryId) {
      return res.status(400).json({ error: 'userId e memoryId são obrigatórios.' });
    }
    try {
      const deleted = await memoryService.deleteMemory(memoryId, userId);
      return res.status(200).json({ success: deleted });
    } catch (err: any) {
      return res.status(403).json({ error: err.message });
    }
  }

  if (action === 'add-memory') {
    const { content, category, importance } = payload;
    if (!userId || !content) {
      return res.status(400).json({ error: 'userId e content são obrigatórios.' });
    }
    const created = await memoryService.saveOrUpdateMemory(userId, {
      userId,
      content,
      category: category || 'preference',
      importance: Number(importance || 0.85),
      confidence: 1.0,
      source: 'user_explicit'
    });
    return res.status(200).json({ success: true, memory: created });
  }

  const { queryText, history, perfState, userProfile, screenName, currentPath, activeWorkoutSession } = payload;

  if (!queryText || typeof queryText !== 'string') {
    return res.status(400).json({ error: 'Texto da pergunta é obrigatório.' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'Chave do Gemini API não configurada no servidor.',
        fallback: true
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    // Load persistent user memories for context if userId exists
    let persistentMemoriesContext = '';
    if (userId) {
      const memoryResult = await memoryService.getFormattedMemoriesForContext(userId, queryText);
      persistentMemoriesContext = memoryResult.formattedContext;
    }

    // Extract user biometrics from userProfile & perfState
    const age = userProfile?.age || perfState?.aiStructuredPayload?.userAge || null;
    const weight = userProfile?.weight || perfState?.aiStructuredPayload?.userWeightKg || null;
    const height = userProfile?.height || perfState?.aiStructuredPayload?.userHeightCm || null;
    const sex = userProfile?.sex || perfState?.aiStructuredPayload?.userSex || null;

    let imc = userProfile?.imc || perfState?.aiStructuredPayload?.userIMC || null;
    if (!imc && weight && height) {
      const hM = height / 100;
      imc = Number((weight / (hM * hM)).toFixed(1));
    }

    let bmrKcal: number | null = null;
    let tdeeKcal: number | null = null;
    if (age && weight && height) {
      const isMale = sex === 'male' || sex === 'masculino';
      bmrKcal = Math.round(10 * Number(weight) + 6.25 * Number(height) - 5 * Number(age) + (isMale ? 5 : -161));
      tdeeKcal = Math.round(bmrKcal * 1.4);
    }

    const dailyCaloriesGoal = userProfile?.dailyCalories || perfState?.aiStructuredPayload?.dailyCalories || null;
    const macros = userProfile?.macros || perfState?.aiStructuredPayload?.macros || null;
    const objective = userProfile?.objective || perfState?.aiStructuredPayload?.objective || null;
    const bodyAssessment = userProfile?.bodySelfAssessment || perfState?.aiStructuredPayload?.bodySelfAssessment || null;
    const weeklyFreq = userProfile?.weeklyFrequency || perfState?.aiStructuredPayload?.weeklyFrequency || null;

    // Construct enriched context string
    let userContextSummary = `CONTEXTO ATUAL DA TELA NAVEGADA:
- Tela Atual: ${screenName || 'Visão Geral'} (${currentPath || '/'})

BIOMETRIA E CADASTRO DO ATLETA (DADOS OFICIAIS DE REGISTRO NO SISTEMA):
- Nome: ${userProfile?.name || userProfile?.displayName || perfState?.userName || 'Atleta'}
- Idade Cadastrada: ${age ? `${age} anos` : 'Não informada'}
- Peso Cadastrado: ${weight ? `${weight} kg` : 'Não informado'}
- Altura Cadastrada: ${height ? `${height} cm` : 'Não informada'}
- Sexo Biológico Cadastrado: ${sex === 'male' ? 'Masculino' : sex === 'female' ? 'Feminino' : sex || 'Não informado'}
- IMC (Índice de Massa Corporal): ${imc ? `${imc} kg/m²` : 'Não calculado'}
- Taxa Metabólica Basal (BMR - Gasto Calórico Diário em Repouso por Mifflin-St Jeor): ${bmrKcal ? `${bmrKcal} kcal/dia` : 'Exige idade, peso, altura e sexo'}
- Gasto Calórico Diário Total Estimado (TDEE Repouso + Atividade Moderada): ${tdeeKcal ? `~${tdeeKcal} kcal/dia` : 'N/A'}
- Meta Calórica Diária da Dieta/Perfil: ${dailyCaloriesGoal ? `${dailyCaloriesGoal} kcal/dia` : 'Não configurada'}
- Meta de Macronutrientes Diários: ${macros ? `Proteínas: ${macros.protein}g | Carboidratos: ${macros.carbs}g | Gorduras: ${macros.fats}g` : 'Não configurada'}
- Objetivo de Treino: ${objective || 'Não informado'}
- Autoavaliação Corporal: ${bodyAssessment || 'Não informada'}
- Frequência Semanal Declarada: ${weeklyFreq || 'Não informada'}
`;

    if (persistentMemoriesContext) {
      userContextSummary += `\n${persistentMemoriesContext}\n`;
    }

    if (activeWorkoutSession && activeWorkoutSession.isSessionActive) {
      const hrText = (activeWorkoutSession.hasHeartRateSensor && activeWorkoutSession.currentHeartRate)
        ? `${activeWorkoutSession.currentHeartRate} bpm (${activeWorkoutSession.currentZone || 'Zona Ativa'})`
        : 'Sem sensor / relógio conectado (Apenas cronômetro e estimativa calórica METs)';
      userContextSummary += `
SESSÃO DE TREINO EM ANDAMENTO AGORA (MÉTRICAS EM TEMPO REAL):
- Status: SESSÃO ATIVA AGORA
- Modalidade: ${activeWorkoutSession.cardioTypeLabel || activeWorkoutSession.type || 'Treino Geral'}
- Tempo Decorrido do Treino: ${activeWorkoutSession.elapsedFormatted || '0 minutos'}
- Calorias Queimadas Estimadas nesta Sessão: ${activeWorkoutSession.estimatedCalories || 0} kcal
- Frequência Cardíaca em Tempo Real: ${hrText}
- Check-in / Validação: ${activeWorkoutSession.checkInId ? 'Validado por Geofence/Academia' : 'Cronômetro Ativo'}
`;
    }
    if (perfState) {
      const avgHRVal = perfState.computedMetrics?.['avg_heart_rate']?.hasEnoughData
        ? `${perfState.computedMetrics['avg_heart_rate'].currentValue} bpm`
        : 'Sem relógio / sensor de FC conectado';
      const maxHRVal = perfState.computedMetrics?.['max_heart_rate_session']?.hasEnoughData
        ? `${perfState.computedMetrics['max_heart_rate_session'].currentValue} bpm`
        : 'Sem relógio / sensor de FC conectado';
      userContextSummary += `
MÉTRICAS DE PERFORMANCE E HISTÓRICO DE TREINOS:
- Período Selecionado: ${perfState.selectedRange || '7days'}
- Prontidão / Recuperação Calculada: ${perfState.readinessScore || 'N/A'}/100 (${perfState.readinessStatus || 'N/A'})
- Pontuação IGA Semanal: ${perfState.computedMetrics?.['iga_weekly_score']?.currentValue || userProfile?.weeklyScore || 0} pts
- Total de Treinos Auditados no Período: ${perfState.timeframeWorkouts?.length || 0}
- Total de Treinos em Todo o Histórico: ${perfState.allWorkouts?.length || 0}
- Minutos Treinados no Período: ${perfState.computedMetrics?.['total_volume_time']?.currentValue || 0} min
- Frequência Cardíaca Média Registrada: ${avgHRVal}
- Frequência Cardíaca Máxima em Sessão: ${maxHRVal}
- Status do Smartwatch / Wearable: ${perfState.computedMetrics?.['avg_heart_rate']?.hasEnoughData ? 'Conectado com dados biométricos' : 'NENHUM smartwatch conectado'}
- Projetado de Treinos no Mês: ${perfState.computedMetrics?.['projected_monthly_workouts']?.currentValue || 0}
- Nível de Confiabilidade dos Dados: ${(perfState.overallReliability || 'alta').toUpperCase()}
- Recordes Pessoais (PRs): ${JSON.stringify(perfState.personalRecords || [])}
- Eventos da Linha do Tempo: ${JSON.stringify((perfState.timelineEvents || []).slice(0, 5))}
- Zonas Cardíacas: ${JSON.stringify(perfState.hrZones || [])}
`;
    } else if (userProfile) {
      userContextSummary += `
PERFIL ADICIONAL DO USUÁRIO:
- Pontuação IGA: ${userProfile.weeklyScore || userProfile.score || 0} pts
- Sequência (Streak): ${userProfile.streak || 0} dias
`;
    } else {
      userContextSummary += `
AVISO: Nenhum dado individualizado pré-carregado nesta chamada. Se o usuário perguntar sobre o próprio histórico, responda com conhecimento científico e indique que a análise personalizada ficará disponível assim que os dados forem sincronizados.
`;
    }

    // Prepare message history string
    let formattedHistory = '';
    if (Array.isArray(history) && history.length > 0) {
      formattedHistory = history
        .slice(-6)
        .map((m: any) => `${m.sender === 'user' ? 'Usuário' : 'Invictus AI'}: ${m.text}`)
        .join('\n');
    }

    const fullPrompt = `
${userContextSummary}

HISTÓRICO DA CONVERSA RECENTE:
${formattedHistory || 'Início de conversa'}

NOVA PERGUNTA DO USUÁRIO:
"${queryText}"

Responda como a Invictus Performance IA seguindo rigorosamente os 4 domínios e regras de raciocínio. Seja direto, didático, científico e encorajador.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: fullPrompt,
      config: {
        systemInstruction: INVICTUS_AI_SYSTEM_PROMPT,
        temperature: 0.7,
        topP: 0.95
      }
    });

    const aiText = response.text || 'Não foi possível processar a resposta no momento.';

    // Generate TTS Audio using gemini-2.5-flash-preview-tts with voice 'Sulafat'
    let audioBase64: string | null = null;
    let audioMimeType: string = 'audio/mp3';

    try {
      const cleanTtsText = aiText
        .replace(/[\*\_~`#]/g, '')
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
        .trim();

      const ttsResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: cleanTtsText || aiText,
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Sulafat'
              }
            }
          },
          systemInstruction: 'Você é um personal trainer altamente capacitado do Invictus IA. Fale com um tom natural, caloroso, enérgico, motivador e focado na evolução do atleta.'
        }
      });

      const parts = ttsResponse.candidates?.[0]?.content?.parts;
      if (parts && parts.length > 0) {
        for (const part of parts) {
          if (part.inlineData?.data) {
            audioBase64 = part.inlineData.data;
            audioMimeType = part.inlineData.mimeType || 'audio/mp3';
            break;
          }
        }
      }
    } catch (ttsErr: any) {
      console.warn('[PerformanceAI] TTS generation failed:', ttsErr?.message || ttsErr);
    }

    // Silently extract and save persistent memories in the background
    if (userId) {
      memoryService
        .extractAndStoreMemoriesFromInteraction(userId, queryText, aiText)
        .catch(err => console.warn('[PerformanceAI] Memory extraction error:', err));
    }

    return res.json({
      answer: aiText,
      audioBase64,
      audioMimeType,
      audio: audioBase64 ? { data: audioBase64, mimeType: audioMimeType } : null,
      confidence: perfState?.overallReliability?.toUpperCase() || 'ALTA',
      sources: [
        'Banco de Treinos Invictus (Firestore)',
        'Memória Individual Invictus IA',
        'Motor Biométrico & Auditoria IGA Engine',
        'Voz Neural Invictus (Gemini 2.5 Flash TTS - Sulafat)'
      ],
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    });
  } catch (err: any) {
    console.error('[API Performance AI Error]:', err);
    return res.status(500).json({
      error: 'Erro ao conectar à Invictus Performance AI.',
      details: err.message
    });
  }
}
