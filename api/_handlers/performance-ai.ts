import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { GoogleGenAI } from '@google/genai';
import { MemoryRepository } from '../_repositories/memory-repository.js';
import { MemoryService } from '../_services/ai/memory-service.js';

const memoryRepo = new MemoryRepository();
const memoryService = new MemoryService(memoryRepo);

function buildSystemPrompt(aiName: string = 'IA Invictus', aiPersonality: string = 'motivadora') {
  let personalityInstruction = '';

  switch (aiPersonality) {
    case 'tecnica':
      personalityInstruction = `
PERSONALIDADE TÉCNICA (CIÊNCIA E MÉTRICAS):
- Seu tom é altamente analítico, preciso e embasado na fisiologia e ciência do esporte.
- Foque em dados reais, métricas do IGA, zonas de frequência cardíaca, cálculo de volume, TDEE, BMR e biomecânica.
- Explique o 'porquê' fisiológico das recomendações com clareza científica.`;
      break;
    case 'direta':
      personalityInstruction = `
PERSONALIDADE DIRETA (OBJETIVA E FIRME):
- Seu tom é firme, direto ao ponto e sem rodeios ou excesso de floreios.
- Dê instruções claras, focadas na ação imediata e no resultado.
- Seja breve, assertivo e focado na disciplina do treino.`;
      break;
    case 'zen':
      personalityInstruction = `
PERSONALIDADE ZEN (ACOLHEDORA E CONSCIENTE):
- Seu tom é calmo, equilibrado, empático e focado no bem-estar integral.
- Valorize a escuta do corpo, a recuperação adequada, a constância sustentável e a saúde mental.
- Dê orientações que incentivem a evolução sem sofrimento desnecessário ou sobrecarga.`;
      break;
    case 'motivadora':
    default:
      personalityInstruction = `
PERSONALIDADE MOTIVADORA (ENÉRGICA E INSPIRADORA):
- Seu tom é vibrante, otimista, enérgico e contagiante.
- Celebre pequenas vitórias, incentive o atleta a superar limites e mantenha a energia lá no alto.
- Use frases de incentivo focadas na garra, consistência e mentalidade campeã.`;
      break;
  }

  return `
# PROMPT DE IDENTIDADE E PERSONALIDADE DA IA DO INVICTUS

Você é a **${aiName}**, a inteligência de treino oficial e Coach Pessoal do atleta no INVICTUS.
Sua missão é orientar, motivar e esclarecer dúvidas do usuário de forma inteligente, natural e objetiva.

---

# IDENTIDADE E PERSONALIDADE DA IA
Seu nome oficial para o atleta é: **${aiName}**.
Refira-se a si mesmo(a) como **${aiName}** quando apropriado.

${personalityInstruction}

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

# REGRAS DE OURO, POLÍTICA DE RESPOSTAS CURTAS E PROGRESSIVE DISCLOSURE

1. POLÍTICA DE RESPOSTAS CURTAS POR PADRÃO:
   - PERGUNTA SIMPLES OU DIRETA: Responda em 1 a 3 frases concisas.
   - ORIENTAÇÃO OU DICA: No máximo 4 a 5 linhas visuais no total.
   - ANÁLISE DE EVOLUÇÃO / DESEMPENHO PADRÃO:
     Estruture em 3 partes limpas:
     1. Conclusão breve e direta (1 linha).
     2. Até 3 dados/métricas reais mais importantes (extraídos estritamente do contexto fornecido, nunca inventados) com marcadores visuais.
     3. Próximo passo acionável (ex: "★ Próximo passo: ...").
     4. Finalize com a ação: "[Ver análise completa >]" quando houver mais detalhes no histórico.

2. EXPANSÃO E ANÁLISE COMPLETA (PROGRESSIVE DISCLOSURE):
   - Apenas forneça respostas aprofundadas, detalhadas ou com múltiplos parágrafos quando o usuário solicitar explicitamente termos como "análise completa", "ver análise completa", "detalhe", "explique melhor", "quero mais dados", "aprofundado", "mostre o cálculo" ou "por quê?".

3. PROIBIDO:
   - NUNCA repita a pergunta do usuário.
   - NUNCA faça introduções longas ou saudações repetitivas a cada turno.
   - NUNCA despeje tabelas gigantescas ou métricas desnecessárias sem pedido explícito.
   - NUNCA use frases clichês ou de encerramento vazio como "Espero ter ajudado", "Estou à disposição", "Se precisar de algo...", "Conte comigo".
   - NUNCA invente métricas fictícias. Se faltar dados biométricos (como FC sem smartwatch), mencione que o dado requer conexão com sensor de forma amigável e direta.

4. DIRETRIZES FUNDAMENTAIS DE SEGURANÇA E TRANSPARÊNCIA:
   - Os dados cadastrais do usuário (idade, peso, altura, sexo, IMC, BMR e TDEE estimados) constam no contexto.
   - A IA NUNCA prescreve medicamentos ou dietas hospitalares nem diagnostica patologias.
   - Se houver relatos de emergência médica (dor no peito, falta de ar, desmaio), INTERROMPA A ANÁLISE IMEDIATAMENTE e mande ligar para o SAMU (192) ou ir ao Pronto Socorro.
`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const payload = req.method === 'GET' ? req.query : req.body || {};
  const action = payload.action;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  // A identidade da IA é sempre derivada do ID token. Nunca confie em userId
  // vindo do body/query: isso permitiria acessar memórias de outro atleta.
  const requestedUserId = payload.userId || payload.userProfile?.uid || payload.userProfile?.id;
  if (requestedUserId && requestedUserId !== auth.uid) {
    return res.status(403).json({ error: 'A identidade informada não corresponde à sessão autenticada.' });
  }
  const userId = auth.uid;

  if (req.method === 'GET' && action !== 'get-memories') {
    return res.status(405).json({ error: 'Esta ação exige POST.' });
  }

  // Handle Memory Management Actions
  if (action === 'get-memories') {
    const memories = await memoryService.getUserMemories(userId);
    return res.status(200).json({ memories });
  }

  if (action === 'delete-memory') {
    const memoryId = payload.memoryId;
    if (!memoryId || typeof memoryId !== 'string') {
      return res.status(400).json({ error: 'memoryId é obrigatório.' });
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
    if (!content || typeof content !== 'string' || content.trim().length > 2000) {
      return res.status(400).json({ error: 'content é obrigatório e deve ter no máximo 2.000 caracteres.' });
    }
    const created = await memoryService.saveOrUpdateMemory(userId, {
      userId,
      content: content.trim(),
      category: category || 'preference',
      importance: Math.min(1, Math.max(0, Number(importance ?? 0.85))),
      confidence: 1.0,
      source: 'user_explicit'
    });
    return res.status(200).json({ success: true, memory: created });
  }

  const { queryText, history, perfState, userProfile, screenName, currentPath, activeWorkoutSession } = payload;

  if (!queryText || typeof queryText !== 'string' || queryText.trim().length > 4000) {
    return res.status(400).json({ error: 'Texto da pergunta é obrigatório e deve ter no máximo 4.000 caracteres.' });
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
      const memoryResult = await memoryService.getFormattedMemoriesForContext(userId, queryText.trim());
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
        .map((m: any) => `${m.sender === 'user' ? 'Usuário' : 'Invictus AI'}: ${String(m.text || '').slice(0, 2000)}`)
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

    const dynamicSystemPrompt = buildSystemPrompt(
      payload.aiName || userProfile?.aiName || 'IA Invictus',
      payload.aiPersonality || userProfile?.aiPersonality || 'motivadora'
    );

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: fullPrompt,
      config: {
        systemInstruction: dynamicSystemPrompt,
        temperature: 0.7,
        topP: 0.95
      }
    });

    const aiText = response.text || 'Não foi possível processar a resposta no momento.';

    // Generate TTS Audio using gemini-2.5-flash-preview-tts com voz 'Sulafat'.
    // A API de TTS do Gemini ocasionalmente retorna 500 INTERNAL em vez de audio
    // (bug documentado pelo proprio Google, nao especifico do nosso codigo -- ver
    // https://ai.google.dev/gemini-api/docs/speech-generation#limitations).
    // Por isso tentamos algumas vezes antes de desistir; se todas falharem, a
    // resposta segue sem audio e o texto do relatorio/chat continua normal.
    let audioBase64: string | null = null;
    let audioMimeType: string = 'audio/mp3';

    const cleanTtsText = aiText
      .replace(/[\*\_~`#]/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .trim();

    const MAX_TTS_ATTEMPTS = 3;
    for (let ttsAttempt = 1; ttsAttempt <= MAX_TTS_ATTEMPTS; ttsAttempt++) {
      try {
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

        if (audioBase64) break;
      } catch (ttsErr: any) {
        console.warn(`[PerformanceAI] TTS generation attempt ${ttsAttempt}/${MAX_TTS_ATTEMPTS} failed:`, ttsErr?.message || ttsErr);
      }

      if (!audioBase64 && ttsAttempt < MAX_TTS_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 400 * ttsAttempt));
      }
    }

    // Silently extract and save persistent memories in the background
    if (userId) {
      memoryService
        .extractAndStoreMemoriesFromInteraction(userId, queryText.trim(), aiText)
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
      error: 'Erro ao conectar à Invictus Performance AI.'
    });
  }
}
