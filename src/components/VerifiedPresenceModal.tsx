import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, 
  ShieldCheck, 
  RotateCw, 
  TriangleAlert, 
  Eye, 
  Sparkles, 
  Info,
  Lock,
  Focus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth } from '../firebase';

interface VerifiedPresenceModalProps {
  isOpen: boolean;
  presenceCheckId: string;
  livenessPrompt: string;
  userMessage?: string;
  onClose: () => void;
  /** commitResult: payload especifico do actionType (ex.: QR code PIX da inscricao de campeonato, ou o registro de saque) -- ver commitResult em api/_handlers/validate-presence.ts. */
  onSuccess: (result: { status: string; userMessage: string; pointsAwarded?: number; commitResult?: any }) => void;
}

export const VerifiedPresenceModal: React.FC<VerifiedPresenceModalProps> = ({
  isOpen,
  presenceCheckId,
  livenessPrompt,
  userMessage,
  onClose,
  onSuccess
}) => {
  const [streamState, setStreamState] = useState<MediaStream | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [showCountdown, setShowCountdown] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Start the camera-only stream used for presence validation.
  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      shutdownCamera();
    }
    return () => {
      shutdownCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    setErrorText(null);
    setCapturedPhoto(null);
    setUseFallback(false);
    
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: 'user', 
            width: { ideal: 640 }, 
            height: { ideal: 640 } 
          },
          audio: false
        });
        
        setStreamState(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } else {
        setUseFallback(true);
        setErrorText('Este dispositivo não disponibilizou uma câmera para a verificação de presença. Tente novamente em um aparelho com câmera liberada.');
      }
    } catch (err: any) {
      console.warn('Acesso à câmera bloqueado para verificação de presença:', err);
      setUseFallback(true);
      setErrorText('Não foi possível acessar a câmera. Verifique a permissão de câmera do aplicativo e tente novamente.');
    }
  };

  const shutdownCamera = () => {
    if (streamState) {
      streamState.getTracks().forEach(track => track.stop());
      setStreamState(null);
    }
  };

  // Countdown timer for automated snapshot capture
  const triggerSelfieCountdown = () => {
    setShowCountdown(true);
    setCountdown(3);
    
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setShowCountdown(false);
          captureImageSnapshot();
          return 3;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Extract frame snapshot as base64
  const captureImageSnapshot = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        // Draw square frame centered
        const size = Math.min(video.videoWidth, video.videoHeight);
        const startX = (video.videoWidth - size) / 2;
        const startY = (video.videoHeight - size) / 2;
        
        canvas.width = 480;
        canvas.height = 480;
        
        ctx.drawImage(
          video,
          startX, startY, size, size,
          0, 0, 480, 480
        );
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setCapturedPhoto(dataUrl);
      }
    }
  };

  // Submit to biometrics endpoint
  const submitBiometrics = async () => {
    if (!capturedPhoto) return;
    
    setIsAnalyzing(true);
    setErrorText(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("Sua sessão expirou. Autentique-se novamente.");
      }

      const idToken = await user.getIdToken();
      const response = await fetch('/api/validate-presence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          presenceCheckId,
          photoBase64: capturedPhoto
        })
      });

      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.userMessage || result.error || "Ocorreu uma inconsistência ao processar sua foto facial.");
      }

      // Success callback
      shutdownCamera();
      onSuccess({
        status: result.status,
        userMessage: result.userMessage,
        pointsAwarded: result.pointsAwarded,
        commitResult: result.commitResult
      });

    } catch (err: any) {
      setErrorText(err.message || "Erro de conexão ao servidor biométrico.");
      setIsAnalyzing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div id="verified-presence-backdrop" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div 
        id="verified-presence-card"
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="relative w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden text-zinc-100 flex flex-col"
      >
        {/* Guard Header */}
        <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-cyan-500 via-emerald-500 to-sky-500" />
        
        <div className="p-6 pb-2 flex items-center justify-between border-b border-zinc-900">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-950/50 border border-cyan-800/50 rounded-xl">
              <ShieldCheck className="w-5 h-5 text-cyan-400 animate-pulse" />
            </div>
            <div>
              <span className="text-xs uppercase font-semibold text-cyan-400 font-mono tracking-widest">
                Proteção Ativa
              </span>
              <h2 className="text-lg font-bold font-sans tracking-tight text-white flex items-center gap-1.5">
                PRESENÇA VERIFICADA
              </h2>
            </div>
          </div>
          
          <div className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded-full">
            <span className="text-[10px] font-mono text-zinc-500">MÉTODO: BIOMETRIA_IA</span>
          </div>
        </div>

        {/* Info Explainer */}
        <div className="p-4 bg-zinc-900/40 border-b border-zinc-900 flex items-start gap-3">
          <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-400 leading-relaxed">
            {userMessage || "Para manter a integridade dos desafios e evitar fraude, complete a confirmação com o gesto solicitado."}
          </p>
        </div>

        {/* Main interactive camera workflow */}
        <div className="flex-1 p-6 flex flex-col items-center justify-center min-h-[380px]">
          {isAnalyzing ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="relative w-24 h-24 flex items-center justify-center">
                <motion.div 
                  className="absolute inset-0 border-2 border-dashed border-cyan-500 rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 6, ease: "linear" }}
                />
                <motion.div 
                  className="absolute inset-2 bg-cyan-950/40 border border-cyan-500/30 rounded-full flex items-center justify-center"
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ repeat: Infinity, duration: 1.8 }}
                >
                  <Sparkles className="w-8 h-8 text-cyan-400" />
                </motion.div>
              </div>
              <h3 className="mt-8 text-lg font-bold text-white tracking-tight">Análise Biométrica por Inteligência Artificial</h3>
              <p className="mt-2 text-sm text-zinc-400 max-w-xs mx-auto leading-relaxed">
                Nossos modelos estão analisando sua prova de vida (liveness), o gesto solicitado e a autenticação facial com seu perfil.
              </p>
              
              <div className="mt-6 px-4 py-2 bg-zinc-900/80 border border-zinc-800 rounded-2xl max-w-sm flex items-center gap-3">
                <Lock className="w-4 h-4 text-zinc-500 shrink-0" />
                <span className="text-[11px] font-mono text-zinc-500 leading-none">
                  Processado em ambiente de nuvem criptografado.
                </span>
              </div>
            </div>
          ) : capturedPhoto ? (
            // REVIEW SNAPSHOT STATE
            <div className="relative flex flex-col items-center w-full">
              <div className="relative w-64 h-64 border-4 border-emerald-500/50 rounded-full overflow-hidden shadow-2xl bg-zinc-900">
                <img 
                  src={capturedPhoto} 
                  alt="Selfie Biométrica" 
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end justify-center p-3">
                  <span className="text-[10px] uppercase tracking-wider font-mono bg-emerald-500/80 text-black px-2.5 py-0.5 rounded-full font-bold">
                    CAPTURADO
                  </span>
                </div>
              </div>

              {/* Gesto match reminder */}
              <div className="mt-6 text-center">
                <span className="text-xs text-zinc-500 uppercase tracking-widest font-mono">Gesto biométrico solicitado:</span>
                <p className="text-md font-bold text-white uppercase mt-0.5 border border-zinc-800 bg-zinc-900 px-4 py-1.5 rounded-xl inline-block">
                  {livenessPrompt}
                </p>
                <p className="text-xs text-yellow-500 mt-2 flex items-center gap-1 justify-center">
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                  Sua selfie bate com o gesto pedido e possui boa iluminação?
                </p>
              </div>

              {/* Action Buttons */}
              <div className="mt-8 w-full flex gap-3">
                <button
                  id="recommence-capture-btn"
                  onClick={() => { setCapturedPhoto(null); if (!useFallback) startCamera(); }}
                  className="flex-1 py-3 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 text-white font-medium text-sm rounded-2xl transition duration-200"
                >
                  Refazer Foto
                </button>
                <button
                  id="submit-presence-photo-btn"
                  onClick={submitBiometrics}
                  className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:brightness-110 text-zinc-950 font-bold text-sm rounded-2xl shadow-lg transition duration-200"
                >
                  Confirmar Presença
                </button>
              </div>
            </div>
          ) : (
            // LIVE PREVIEW SCANNER STATE
            <div className="w-full flex flex-col items-center">
              {/* Dynamic Liveness instruction header */}
              <div className="w-full text-center mb-6 px-4 py-3 bg-cyan-950/20 border border-cyan-500/20 rounded-2xl">
                <span className="text-[11px] font-mono text-cyan-400 uppercase tracking-widest font-semibold flex items-center justify-center gap-1.5">
                  <Focus className="w-3.5 h-3.5 animate-pulse" />
                  Gesto Requerido de Prova de Vida
                </span>
                <p className="text-lg font-black text-white uppercase mt-1 tracking-tight font-sans">
                  "{livenessPrompt}"
                </p>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Traga o rosto ao centro da marcação e execute o movimento solicitado.
                </p>
              </div>

              {/* The webcam feed or fallback container */}
              <div className="relative w-64 h-64 flex items-center justify-center">
                
                {useFallback ? (
                  <div className="w-64 h-64 border border-zinc-805 bg-zinc-900/50 rounded-full flex flex-col items-center justify-center p-4 text-center">
                    <Camera className="w-10 h-10 text-zinc-500 mb-3" />
                    <p className="text-xs text-zinc-400 uppercase tracking-wider font-semibold font-mono">Câmera indisponível</p>
                    <p className="text-[10px] text-zinc-500 leading-normal mt-1 max-w-[180px]">
                      A confirmação exige uma captura ao vivo. O aplicativo não usa imagens escolhidas da galeria como prova de presença.
                    </p>
                    <button
                      id="retry-live-camera-btn"
                      onClick={startCamera}
                      className="mt-4 px-3.5 py-1.5 bg-cyan-950 text-cyan-400 border border-cyan-800 hover:bg-cyan-900 font-bold text-xs rounded-xl tracking-tight transition duration-150"
                    >
                      Tentar abrir câmera
                    </button>
                  </div>
                ) : (
                  <div className="relative w-64 h-64 border-4 border-cyan-500/30 rounded-full overflow-hidden shadow-inner bg-zinc-950 select-none">
                    <video 
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                    
                    {/* Centering overlay line circle */}
                    <div className="absolute inset-0 border-2 border-dashed border-cyan-400/40 rounded-full pointer-events-none scale-90" />
                    <div className="absolute inset-0 border border-cyan-400/20 rounded-full pointer-events-none scale-[0.6] animate-pulse" />

                    {/* Laser Scanner scanline effect */}
                    <motion.div 
                      className="absolute left-0 right-0 h-0.5 bg-cyan-400/60 shadow-[0_0_10px_#22d3ee] pointer-events-none"
                      animate={{ top: ['5%', '95%', '5%'] }}
                      transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                    />

                    {/* Telemetry countdown overlays */}
                    {showCountdown && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <motion.span 
                          key={countdown}
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1.3, opacity: 1 }}
                          exit={{ scale: 0.7, opacity: 0 }}
                          className="text-6xl font-black text-white font-mono"
                        >
                          {countdown}
                        </motion.span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <p className="mt-5 max-w-sm px-4 text-center text-[10px] leading-relaxed text-zinc-500">
                A validação de presença é decidida no servidor após o envio; esta tela não exibe indicadores biométricos simulados.
              </p>

              {/* Action Buttons */}
              <div className="mt-8 w-full flex items-center justify-between gap-3">
                <button
                  id="cancel-biometric-popup"
                  onClick={() => {
                    shutdownCamera();
                    onClose();
                  }}
                  className="px-6 py-3 bg-zinc-900 text-zinc-400 border border-zinc-805 hover:bg-zinc-850 hover:text-white text-xs font-semibold rounded-2xl transition duration-150"
                >
                  Cancelar verificação
                </button>

                {!useFallback && (
                  <button
                    id="snap-selfie-countdown-btn"
                    onClick={triggerSelfieCountdown}
                    disabled={showCountdown}
                    className="flex-1 py-3 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black font-bold text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-lg hover:shadow-cyan-500/20 transition duration-150"
                  >
                    <Camera className="w-4 h-4 shrink-0" />
                    {showCountdown ? 'Registrando...' : 'Capturar Foto'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorText && (
            <div className="mt-4 px-4 py-3 bg-red-950/40 border border-red-800/40 rounded-2xl flex items-start gap-3 w-full">
              <TriangleAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="text-[10px] font-bold uppercase text-red-400 font-mono block">VERIFICAÇÃO FALHOU</span>
                <p className="text-xs text-zinc-300 mt-1 leading-normal">
                  {errorText}
                </p>
                <button 
                  onClick={startCamera}
                  className="text-[10px] font-bold text-sky-400 underline mt-1 block"
                >
                  Tentar Reiniciar Câmera
                </button>
              </div>
            </div>
          )}

          {/* Capture hidden elements to process canvas snapshot drawing */}
          <canvas ref={canvasRef} className="hidden" />
        </div>
      </motion.div>
    </div>
  );
};
