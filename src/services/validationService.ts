import { ValidationResult, ActivitySession } from "../types";
import { API_CONFIG } from "../config";
import { auth } from "../firebase";
import { antiCheatService } from "./antiCheatService";

// #224: este servico NAO fala mais com o Gemini diretamente.
//
// Dois motivos:
//
// 1. SEGURANCA DA CHAVE. Para o cliente chamar o Gemini, o vite.config.ts
//    precisava embutir a GEMINI_API_KEY no bundle publico. Qualquer pessoa
//    conseguia abrir o JS de invictusperformance.app.br e extrair a chave.
//
// 2. ANTIFRAUDE. Validacao rodando no aparelho do proprio atleta e
//    falsificavel: bastava adulterar a resposta no navegador para homologar
//    um treino que nunca aconteceu. A decisao agora e tomada no servidor.
//
// 3. BOOT DO APP NATIVO (#223). Construir o cliente Gemini no escopo do modulo
//    lancava excecao quando a chave estava vazia (build do Codemagic nao tem a
//    variavel), derrubando o app inteiro antes do React montar.
//
// Toda chamada de IA passa a ser POST /api/validate-activity.
// Fail-closed: qualquer falha manda a atividade para revisao manual, nunca
// aprova automaticamente.

const REVISAO_MANUAL_IMAGEM = {
  isValid: false,
  status: "pending_review",
  requiresManualReview: true,
  pointsAwarded: 0,
  reason: "AI_VALIDATION_UNAVAILABLE",
  analysis: "Sua atividade foi recebida e está em análise. Não foi possível concluir a validação automática neste momento.",
  confidence: 0
};

// Sempre use a URL absoluta de API_CONFIG.baseUrl. No app nativo o WebView roda
// em capacitor://localhost, entao fetch('/api/...') aponta para um host que nao
// existe e nenhuma chamada de backend funciona (mesma causa do #223).
async function cabecalhosAutenticados(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers['Authorization'] = 'Bearer ' + token;
  }
  return headers;
}

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
      const headers = await cabecalhosAutenticados();
      const response = await fetch(API_CONFIG.baseUrl + '/api/gyms?lat=' + lat + '&lng=' + lng, { headers });

      if (!response.ok) {
        console.error('[ValidationService] Nearby Gyms API failed with status: ' + response.status);
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
   * Valida uma imagem de atividade. A analise por IA acontece no servidor
   * (POST /api/validate-activity com type: 'image_validation') -- ver #224.
   */
  async validateImage(base64Image: string, type: 'workout' | 'cardio' | 'diet'): Promise<{ isValid: boolean; analysis: string; confidence: number; status?: string; requiresManualReview?: boolean; pointsAwarded?: number; reason?: string }> {
    try {
      const headers = await cabecalhosAutenticados();
      const response = await fetch(API_CONFIG.baseUrl + '/api/validate-activity', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'image_validation',
          imageType: type,
          photoBase64: base64Image
        })
      });

      if (!response.ok) {
        console.warn('[ValidationService] validateImage HTTP ' + response.status + ' - indo para revisao manual.');
        return { ...REVISAO_MANUAL_IMAGEM };
      }

      const data = await response.json();
      return {
        isValid: data.isValid === true,
        analysis: data.analysis || "Não foi possível analisar a imagem.",
        confidence: Number(data.confidence) || 0,
        status: data.status,
        requiresManualReview: data.requiresManualReview,
        pointsAwarded: data.pointsAwarded,
        reason: data.reason
      };
    } catch (error) {
      console.error('[ValidationService] Falha ao validar imagem no servidor:', error);
      return { ...REVISAO_MANUAL_IMAGEM };
    }
  },

  /**
   * Envia os frames do Power Lift para auditoria no servidor.
   *
   * #224: o fallback que rodava o Gemini no proprio aparelho foi REMOVIDO.
   * Ele exigia a chave de IA no cliente e, pior, permitia que uma marca fosse
   * homologada por uma decisao tomada dentro do celular do proprio atleta.
   * Agora, se o servidor nao responder, a tentativa vai para AUDITORIA_MANUAL.
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
    const exName = exercise === 'supino' ? 'Supino' : exercise === 'agachamento' ? 'Agachamento' : 'Terra';

    try {
      const headers = await cabecalhosAutenticados();

      const frames = Array.isArray(frameBase64OrFrames)
        ? frameBase64OrFrames
        : [frameBase64OrFrames];

      const response = await fetch(API_CONFIG.baseUrl + '/api/validate-activity', {
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

        const motivos = data.motivos || [];
        const resumoMotivos = motivos.length > 0
          ? motivos.map((m: string) => '• ' + m).join('\n')
          : data.resumoMotivos || (isValid ? '• Todos os critérios de execução, ambiente e biomecânica atendidos.' : '• Não atendeu aos critérios de validação de vídeo e segurança.');

        const mensagemParabens = data.mensagemParabens ||
          ('🎉 PARABÉNS! NOVA MARCA RECORDE HOMOLOGADA COM SUCESSO! 🏆\n\nSua nova marca de ' + weight + 'kg no ' + exName +
           ' foi validada com ' + confidence + '% de confiança pela inteligência de auditoria de força Invictus!\n\nSeu recorde oficial e ranking foram atualizados com sucesso!');

        const mensagemRecusa = data.mensagemRecusa ||
          ('❌ REGISTRO DE MARCA RECUSADO\n\nSua tentativa de registro de nova marca (' + weight + 'kg no ' + exName +
           ') não pôde ser homologada.\n\n📋 RESUMO DOS MOTIVOS DA RECUSA:\n' + resumoMotivos +
           '\n\n💡 Dica de Auditoria: Grave em ambiente de academia visível, com a barra e anilhas nítidas, e mantendo a amplitude completa.');

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

      console.warn('[ValidationService] validatePowerVideo HTTP ' + response.status + ' - indo para auditoria manual.');
    } catch (err) {
      console.warn('[ValidationService] Falha ao chamar a auditoria no servidor:', err);
    }

    return {
      isValid: false,
      isManualReview: true,
      auditResult: 'AUDITORIA_MANUAL',
      analysis: "STATUS: AUDITORIA_MANUAL\nCONFIANÇA: 85%\nMOTIVOS:\n• Vídeo submetido para revisão técnica da equipe de auditoria.",
      confidence: 85,
      estimatedWeight: weight,
      motivos: ["Vídeo submetido para revisão técnica da equipe de auditoria."]
    };
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
        reasons.push('IA: ' + aiResult.analysis);
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
        reasons.push('Padrão GPS suspeito: ' + gpsAnalysis.reason);
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
