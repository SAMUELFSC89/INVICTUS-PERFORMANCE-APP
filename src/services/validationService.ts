import { GoogleGenAI, Type } from "@google/genai";
import { ValidationResult, ActivitySession } from "../types";
import { API_CONFIG } from "../config";
import { auth } from "../firebase";
import { antiCheatService } from "./antiCheatService";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
// #223 - CAUSA RAIZ DO CRASH NO APP iOS.
//
// Antes esta linha era:
//     const ai = new GoogleGenAI({ apiKey: GEMINI_KEY || '' });
//
// O construtor do SDK @google/genai LANCA EXCECAO quando a apiKey e vazia.
// Como a chamada estava no escopo do modulo, a excecao acontecia durante a
// avaliacao do bundle, ANTES do React montar -- derrubando o app inteiro e
// aparecendo no iPhone apenas como "Script error.".
//
// Isso nao acontecia na web porque o build da Vercel tem GEMINI_API_KEY
// definida (o vite.config.ts substitui process.env.GEMINI_API_KEY em tempo
// de build). O build nativo do Codemagic NAO tem essa variavel, entao a
// chave virava vazia e o app quebrava so no celular.
//
// Agora o cliente e criado sob demanda. Os dois pontos que usam
// ai.models.generateContent ja estao dentro de try/catch e ja sao protegidos
// por 'if (!GEMINI_KEY)', entao o comportamento de fallback
// (pending_review / AUDITORIA_MANUAL) continua exatamente o mesmo.
let _aiClient: GoogleGenAI | null = null;
const ai = {
  get models() {
    if (!_aiClient) {
      if (!GEMINI_KEY) {
        throw new Error('GEMINI_API_KEY ausente neste build: validacao por IA indisponivel no cliente.');
      }
      _aiClient = new GoogleGenAI({ apiKey: GEMINI_KEY });
    }
    return _aiClient.models;
  }
};

export const validationService = {
  /**
   * Calculates distance between two points in km using Haversine formula
   */
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  /**
   * Checks for nearby gyms using Google Places API (New format via Backend Proxy)
   */
  async getNearbyGyms(lat: number, lng: number): Promise<string[]> {
    try {
      const user = auth.currentUser;
      const headers: Record<string, string> = {};
      
      if (user) {
        const token = await user.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_CONFIG.baseUrl}/api/gyms?lat=${lat}&lng=${lng}`, { headers });
      
      if (!response.ok) {
        console.error(`[ValidationService] Nearby Gyms API failed with status: ${response.status}`);
        return [];
      }
      
      const data = await response.json();
      
      if (data.success && data.data) {
        // Mapping according to New API requirements handled in backend
        return data.data.map((r: any) => r.name);
      }
      return [];
    } catch (error: any) {
      console.error('Error fetching nearby gyms (Failed to fetch?):', error.message || error);
      return [];
    }
  },

  /**
   * Validates an image using Gemini AI
   */
  async validateImage(base64Image: string, type: 'workout' | 'cardio' | 'diet'): Promise<{ isValid: boolean; analysis: string; confidence: number; status?: string; requiresManualReview?: boolean; pointsAwarded?: number; reason?: string }> {
    if (!GEMINI_KEY) {
      console.warn('[ValidationService] GEMINI_API_KEY not found. Returning secure fallback.');
      return { 
        isValid: false, 
        status: "pending_review",
        requiresManualReview: true,
        pointsAwarded: 0,
        reason: "AI_VALIDATION_UNAVAILABLE",
        analysis: "Sua atividade foi recebida e está em análise. Não foi possível concluir a validação automática neste momento.", 
        confidence: 0 
      };
    }

    const prompt = type === 'workout' 
      ? "Você é um inspetor de academia rigoroso. Analise esta imagem. Ela mostra de forma clara e inequívoca um ambiente de academia (aparelhos, pesos, sala de aula) ou uma pessoa visivelmente praticando exercícios? REJEITE e considere 'isValid: false' se for apenas uma selfie de rosto sem contexto, fotos de casa, objetos aleatórios ou ambientes não-fitness. Responda em JSON com 'isValid' (boolean), 'analysis' (string curto e direto em português) e 'confidence' (0-100)."
      : type === 'diet'
      ? "Você é um nutricionista avaliando a adesão à dieta. Esta imagem mostra uma refeição real preparada (prato de comida, salada, frutas, lanche saudável)? REJEITE e considere 'isValid: false' se for uma foto de ambiente, uma embalagem fechada, uma pessoa, um animal, objetos aleatórios, telas de computador ou fotos da internet. Deve ser comida real pronta para consumo. Responda em JSON com 'isValid' (boolean), 'analysis' (string curto e direto em português) e 'confidence' (0-100)."
      : "Você é um monitor de desempenho esportivo. Analise esta imagem. Ela mostra de forma clara um contexto de atividade física (pessoa suada, roupa de treino, pista de corrida, parque, academia ou o visor de uma esteira/bike)? REJEITE se for uma foto sem contexto de esforço físico, fotos de ambientes internos comuns, animais, carros ou fotos da internet. Responda em JSON com 'isValid' (boolean), 'analysis' (string curto e direto em português) e 'confidence' (0-100).";

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64Image } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isValid: { type: Type.BOOLEAN },
              analysis: { type: Type.STRING },
              confidence: { type: Type.NUMBER }
            },
            required: ["isValid", "analysis", "confidence"]
          }
        }
      });

      const result = JSON.parse(response.text || '{}');
      return {
        isValid: result.isValid === true, // Ensure boolean
        analysis: result.analysis || "Não foi possível analisar a imagem.",
        confidence: Number(result.confidence) || 0
      };
    } catch (error) {
      console.error('AI Validation Error:', error);
      return { 
        isValid: false, 
        status: "pending_review",
        requiresManualReview: true,
        pointsAwarded: 0,
        reason: "AI_VALIDATION_UNAVAILABLE",
        analysis: "Sua atividade foi recebida e está em análise. Não foi possível concluir a validação automática neste momento.", 
        confidence: 0 
      };
    }
  },

  /**
   * Validates a strength challenge video keyframes using Gemini AI
   */
  async validatePowerVideo(
    frameBase64OrFrames: string | string[], 
    exercise: 'supino' | 'agachamento' | 'terra', 
    weight: number
  ): Promise<{ 
    isValid: boolean; 
    isManualReview?: boolean;
    auditResult?: 'VALIDADO' | 'AUDITORIA_MANUAL' | 'REPROVADO';
    analysis: string; 
    confidence: number; 
    estimatedWeight?: number;
    motivos?: string[];
    resumoMotivos?: string;
    mensagemParabens?: string;
    mensagemRecusa?: string;
    reason?: string 
  }> {
    try {
      const user = auth.currentUser;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (user) {
        const token = await user.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      const frames = Array.isArray(frameBase64OrFrames)
        ? frameBase64OrFrames
        : [frameBase64OrFrames];

      const response = await fetch('/api/validate-activity', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'power_video',
          photoBase64: frames[0] || '',
          framesBase64: frames,
          exercise,
          weight
        })
      });

      if (response.ok) {
        const data = await response.json();
        const confidence = data.confidence || 0;
        const auditResult = data.auditResult || data.status || (data.isValid ? 'VALIDADO' : 'REPROVADO');
        const isValid = auditResult === 'VALIDADO' || (data.isValid === true && confidence >= 95);
        const isManualReview = auditResult === 'AUDITORIA_MANUAL' || data.isManualReview === true || (confidence >= 80 && confidence < 95);
        const exName = exercise === 'supino' ? 'Supino' : exercise === 'agachamento' ? 'Agachamento' : 'Terra';

        const motivos = data.motivos || [];
        const resumoMotivos = motivos.length > 0 
          ? motivos.map((m: string) => `• ${m}`).join('\n')
          : data.resumoMotivos || (isValid ? '• Todos os critérios de execução, ambiente e biomecânica atendidos.' : '• Não atendeu aos critérios de validação de vídeo e segurança.');

        const mensagemParabens = data.mensagemParabens || `🎉 PARABÉNS! NOVA MARCA RECORDE HOMOLOGADA COM SUCESSO! 🏆\n\nSua nova marca de ${weight}kg no ${exName} foi validada com ${confidence}% de confiança pela inteligência de auditoria de força Invictus!\n\nSeu recorde oficial e ranking foram atualizados com sucesso!`;
        const mensagemRecusa = data.mensagemRecusa || `❌ REGISTRO DE MARCA RECUSADO\n\nSua tentativa de registro de nova marca (${weight}kg no ${exName}) não pôde ser homologada.\n\n📋 RESUMO DOS MOTIVOS DA RECUSA:\n${resumoMotivos}\n\n💡 Dica de Auditoria: Grave em ambiente de academia visível, com a barra e anilhas nítidas, e mantendo a amplitude completa.`;

        return {
          isValid,
          isManualReview,
          auditResult: isValid ? 'VALIDADO' : isManualReview ? 'AUDITORIA_MANUAL' : 'REPROVADO',
          analysis: data.analysis || "Resultado da auditoria concluído.",
          confidence,
          estimatedWeight: data.estimatedWeight || weight,
          motivos,
          resumoMotivos,
          mensagemParabens,
          mensagemRecusa,
          reason: data.reasonCode || data.reason || data.userMessage
        };
      }
    } catch (err) {
      console.warn('[ValidationService] Backend validation call failed, using client fallback:', err);
    }

    if (!GEMINI_KEY) {
      return {
        isValid: false,
        isManualReview: true,
        auditResult: 'AUDITORIA_MANUAL',
        analysis: "STATUS: AUDITORIA_MANUAL\nCONFIANÇA: 85%\nMOTIVOS:\n• Vídeo submetido para revisão técnica da equipe de auditoria.",
        confidence: 85,
        estimatedWeight: weight,
        motivos: ["Vídeo submetido para revisão técnica da equipe de auditoria."]
      };
    }

    const exName = exercise === 'supino' ? 'Supino' : exercise === 'agachamento' ? 'Agachamento' : 'Terra';
    const prompt = `# INVICTUS POWER LIFT - SISTEMA DE AUDITORIA OFICIAL POR IA

Você é o sistema oficial e autoridade máxima de auditoria do Invictus Power Lift.
Sua função NÃO é dar dicas de treino ou avaliar estética da execução.
Sua única responsabilidade é determinar se a tentativa de levantamento de força é VÁLIDA, INVÁLIDA ou REQUER AUDITORIA MANUAL conforme as regras estritas abaixo.
A decisão deve ser extremamente rigorosa. NUNCA aprove uma tentativa quando existir dúvida. Na dúvida, REPROVE ou envie para AUDITORIA_MANUAL e informe exatamente qual regra foi violada.

--------------------------------------------------
1. OBJETIVO DA AUDITORIA
--------------------------------------------------
Analisar a mídia/vídeo enviada para o desafio de:
• Exercício Declarado: ${exName}
• Carga Declarada pelo Atleta: ${weight} kg

Confirmar obrigatoriamente:
- Presença e identidade do atleta
- Autenticidade do vídeo/mídia (sem cortes ou edições)
- Ambiente de academia
- Reconhecimento da barra e das anilhas (quantidade, simetria e peso estimado)
- Execução completa e biomecânica do movimento (amplitude, lockout)
- Ausência de qualquer forma de fraude

--------------------------------------------------
2. CONFIRMAÇÃO DO AMBIENTE DE ACADEMIA
--------------------------------------------------
Confirmar de forma clara a presença de um ambiente fitness/academia real.
Procurar por: Equipamentos de musculação, anilhas, barras olímpicas, banco de supino, rack/gaiola de agachamento, plataforma de levantamento, piso emborrachado, espelhos, máquinas ou suportes.
Caso a presença de ambiente de academia seja duvidosa ou ausente: REPROVAR.

--------------------------------------------------
3. IDENTIFICAÇÃO DO EXERCÍCIO
--------------------------------------------------
Reconhecer automaticamente se o vídeo demonstra claramente um dos três exercícios de força:
• Supino Reto
• Agachamento Livre
• Levantamento Terra
Se o exercício mostrado for diferente do declarado (${exName}) ou não puder ser identificado com clareza: REPROVAR.

--------------------------------------------------
4. IDENTIFICAÇÃO DA BARRA E REGRA DE ANILHAS
--------------------------------------------------
• BARRA: Detectar se há barra (olímpica, comum ou smith). Se não houver barra: REPROVAR.
• EXIBIÇÃO DA 1ª ANILHA NO INÍCIO: O vídeo DEVE obrigatoriamente abrir/iniciar mostrando claramente o peso impresso/marcado na primeira anilha (ex: 20kg, 15kg, 25kg, 45lb).
• MÚLTIPLAS ANILHAS: Se houver mais de uma anilha de cada lado, exige-se apenas a exibição nítida da primeira anilha no início. No entanto, o atleta DEVE informar (seja por áudio falado no vídeo ou por texto impresso/sobreposto na tela) o peso total combinado das demais anilhas.
• CONTINUIDADE SEM CORTES: O vídeo deve ser 100% contínuo desde a exibição inicial do peso na primeira anilha até a conclusão total do levantamento (lockout), sem cortes, edições, pausas de câmera ou acelerações. Se a primeira anilha não for exibida no início ou o vídeo contiver cortes: REPROVAR.

--------------------------------------------------
5. VALIDAÇÃO BIOMECÂNICA DA EXECUÇÃO
--------------------------------------------------
• SUPINO: atleta deitado no banco, barra inicia parada, descida controlada com a barra tocando claramente o peito, subida contínua, extensão completa dos cotovelos (lockout), sem ajuda de terceiros e sem quicar a barra no peito.
• AGACHAMENTO LIVRE: barra apoiada nas costas, atleta ereto, descida onde o quadril ultrapassa claramente a linha superior dos joelhos (profundidade válida), subida contínua com extensão completa dos joelhos no topo, sem apoios externos.
• LEVANTAMENTO TERRA: barra parte do chão, puxada única e contínua, extensão completa dos joelhos e quadris (lockout) com ombros finalizando para trás, sem apoios nas coxas (hitching excessivo).
Qualquer falha técnica, meia repetição ou ajuda de outra pessoa: REPROVAR.

--------------------------------------------------
6. ANTIFRAUDE E INTEGRIDADE DIGITAL
--------------------------------------------------
Detectar ativamente: Vídeo editado, cortes, aceleração, câmera pausada, repetição de frames, IA generativa, deepfake, tela filmando monitor/outro celular, vídeo antigo, compressão incompatível, troca de atleta ou interrupções.
Se existir QUALQUER suspeita de fraude digital ou gravação de tela: REPROVAR.

--------------------------------------------------
7. CRITÉRIOS DE CONFIANÇA E STATUS
--------------------------------------------------
Calcule a Confiança Geral de 0 a 100%:
• Confiança >= 95% E todos os critérios 100% atendidos => STATUS: "VALIDADO"
• Confiança entre 80% e 94% OU dúvidas em anilhas/visibilidade => STATUS: "AUDITORIA_MANUAL"
• Confiança < 80% OU violação de regras/suspeita de fraude => STATUS: "REPROVADO"

--------------------------------------------------
RESPOSTA REQUERIDA (JSON)
--------------------------------------------------
Retorne ESTRITAMENTE um JSON no formato:
{
  "status": "VALIDADO" | "AUDITORIA_MANUAL" | "REPROVADO",
  "exercise": "${exName}",
  "estimatedWeight": number,
  "confidence": number,
  "motivos": [ "motivo 1", "motivo 2" ]
}`;

    try {
      const firstFrame = Array.isArray(frameBase64OrFrames) ? frameBase64OrFrames[0] : frameBase64OrFrames;
      const cleanBase64 = (firstFrame || "").replace(/^data:image\/\w+;base64,/, "");
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } },
          { text: prompt }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: { type: Type.STRING },
              exercise: { type: Type.STRING },
              estimatedWeight: { type: Type.NUMBER },
              confidence: { type: Type.NUMBER },
              motivos: { 
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              isValid: { type: Type.BOOLEAN },
              analysis: { type: Type.STRING }
            }
          }
        }
      });

      const result = JSON.parse(response.text || '{}');
      const confidenceNum = Number(result.confidence) || 0;
      let auditResult: 'VALIDADO' | 'AUDITORIA_MANUAL' | 'REPROVADO' = 'REPROVADO';
      
      const rawStatus = (result.status || '').toUpperCase();
      if (rawStatus === 'VALIDADO' || (result.isValid === true && confidenceNum >= 95)) {
        auditResult = confidenceNum >= 95 ? 'VALIDADO' : 'AUDITORIA_MANUAL';
      } else if (rawStatus === 'AUDITORIA_MANUAL' || (result.isValid === true && confidenceNum >= 80)) {
        auditResult = 'AUDITORIA_MANUAL';
      } else {
        auditResult = 'REPROVADO';
      }

      const isValid = auditResult === 'VALIDADO';
      const isManualReview = auditResult === 'AUDITORIA_MANUAL';

      const motivosList: string[] = Array.isArray(result.motivos) && result.motivos.length > 0 
        ? result.motivos 
        : [result.analysis || (isValid ? 'Execução e ambiente validados.' : isManualReview ? 'Requer auditoria manual.' : 'Dúvida ou violação identificada na auditoria.')];

      const formattedAnalysis = `STATUS: ${auditResult}
EXERCÍCIO: ${result.exercise || exName}
PESO ESTIMADO: ${result.estimatedWeight || weight || 0} kg
CONFIANÇA: ${confidenceNum}%
MOTIVOS:
${motivosList.map((m: string) => `• ${m}`).join('\n')}`;

      return {
        isValid,
        isManualReview,
        auditResult,
        analysis: formattedAnalysis,
        confidence: confidenceNum,
        estimatedWeight: result.estimatedWeight || weight || 0,
        motivos: motivosList
      };
    } catch (error) {
      console.error('[ValidationService] Client Gemini Error:', error);
      return {
        isValid: false,
        isManualReview: true,
        auditResult: 'AUDITORIA_MANUAL',
        analysis: "STATUS: AUDITORIA_MANUAL\nCONFIANÇA: 80%\nMOTIVOS:\n• Falha temporária no serviço de auditoria automática. Encaminhado para revisão manual.",
        confidence: 80
      };
    }
  },

  /**
   * Comprehensive validation logic
   */
  async validateActivity(data: {
    type: 'workout' | 'cardio' | 'diet';
    durationMins: number;
    distanceKm?: number;
    startLocation?: { lat: number; lng: number };
    endLocation?: { lat: number; lng: number };
    photoBase64?: string;
    movementData?: any[];
  }): Promise<ValidationResult> {
    let score = 100;
    let status: ValidationResult['status'] = 'valid';
    const reasons: string[] = [];
    const details: any = {
      durationMins: data.durationMins,
      distanceKm: data.distanceKm
    };

    // 1. Time Validation
    if (data.type === 'workout' && data.durationMins < 30) {
      score -= 30;
      reasons.push('Duração do treino inferior a 30 minutos.');
    }
    if (data.type === 'cardio' && data.durationMins < 20) {
      score -= 30;
      reasons.push('Duração do cardio inferior a 20 minutos.');
    }

    // 2. Location Validation (Gym)
    if (data.type === 'workout' && data.startLocation) {
      const gyms = await this.getNearbyGyms(data.startLocation.lat, data.startLocation.lng);
      details.nearbyGyms = gyms;
      if (gyms.length === 0) {
        score -= 40;
        status = 'suspicious';
        reasons.push('Nenhuma academia detectada num raio de 500m.');
      }
    }

    // 3. Distance Validation (Cardio)
    if (data.type === 'cardio' && data.distanceKm !== undefined) {
      if (data.distanceKm < 0.5) {
        score -= 40;
        reasons.push('Distância percorrida inferior a 500m.');
      }
      
      // Speed check (Anti-car)
      const speedKmh = (data.distanceKm / data.durationMins) * 60;
      if (speedKmh > 25) {
        score -= 60;
        status = 'invalid';
        reasons.push('Velocidade média incompatível com cardio humano (provável veículo).');
      }
    }

    // 4. AI Image Validation & Perceptual Fingerprint Security
    if (data.photoBase64) {
      // Perceptual duplicate photo guard
      const isUniquePhoto = await antiCheatService.checkAndRegisterPhotoUniqueness(data.photoBase64);
      if (!isUniquePhoto) {
        score = 0;
        status = 'invalid';
        reasons.push('Fraude: Foto duplicada detectada (Imagem já utilizada em outro treino).');
      }

      const aiResult = await this.validateImage(data.photoBase64, data.type);
      details.aiAnalysis = aiResult.analysis;
      if (!aiResult.isValid) {
        score -= 80;
        status = 'invalid';
        reasons.push(`IA: ${aiResult.analysis}`);
      } else if (aiResult.confidence < 70) {
        score -= 20;
        reasons.push('Confiança da IA moderada.');
      }
    } else if (data.type === 'diet' || data.type === 'workout') {
      score -= 50;
      reasons.push('Foto obrigatória não enviada.');
    }

    // 5. Behavioral GPS analysis
    if (data.type === 'cardio' && data.movementData && data.movementData.length >= 2) {
      const simulatedSession: ActivitySession = {
        id: 'sim_active',
        userId: auth.currentUser?.uid || 'anonymous',
        type: 'cardio',
        startTime: new Date().toISOString(),
        status: 'completed',
        checkpoints: data.movementData.map(c => ({
          timestamp: c.timestamp || new Date().toISOString(),
          location: { lat: c.lat, lng: c.lng, accuracy: c.accuracy }
        }))
      };

      const gpsAnalysis = antiCheatService.analyzeGPSMotion(simulatedSession);
      details.gpsAnalysis = gpsAnalysis;
      if (!gpsAnalysis.isValid) {
        score = Math.max(0, score - gpsAnalysis.suspicionScore);
        status = 'invalid';
        reasons.push(`Padrão GPS suspeito: ${gpsAnalysis.reason}`);
      }
    }

    // Final Status Determination
    if (score < 40) status = 'invalid';
    else if (score < 80) status = 'suspicious';

    return {
      status,
      score,
      reason: reasons.join(' | '),
      details
    };
  }
};