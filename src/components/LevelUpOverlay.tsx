import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Trophy, Zap, Award, Star, Dumbbell, ShieldAlert, BadgeCheck } from 'lucide-react';
import { getLevelTitle, getRandomMotivationalPhrase, getBarbellWeight } from '../lib/levelUtils';

interface LevelUpOverlayProps {
  level: number;
  isOpen: boolean;
  onClose: () => void;
}

export function LevelUpOverlay({ level, isOpen, onClose }: LevelUpOverlayProps) {
  const [quote, setQuote] = useState('');
  
  useEffect(() => {
    if (isOpen) {
      setQuote(getRandomMotivationalPhrase());
      
      // Play a soft synthetic beep/achievement audio sound using Web Audio API to prevent static file assets from failing!
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Main high tone chime
        const playTone = (freq: number, start: number, duration: number, type: OscillatorType = 'triangle') => {
          const osc = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          
          osc.type = type;
          osc.frequency.setValueAtTime(freq, start);
          
          gainNode.gain.setValueAtTime(0.15, start);
          gainNode.gain.exponentialRampToValueAtTime(0.001, start + duration);
          
          osc.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          
          osc.start(start);
          osc.stop(start + duration);
        };

        const now = audioCtx.currentTime;
        // Perfect progressive major chord lift (C4 -> E4 -> G4 -> C5)
        playTone(261.63, now, 0.4);       // C4
        playTone(329.63, now + 0.15, 0.4); // E4
        playTone(392.00, now + 0.3, 0.4);  // G4
        playTone(523.25, now + 0.45, 0.8, 'sine'); // C5 spark
      } catch (e) {
        console.warn("Web Audio API blocked or unsupported:", e);
      }
    }
  }, [isOpen]);

  const rankTitle = getLevelTitle(level);
  const barbellWeight = getBarbellWeight(level);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden">
          {/* 1. Backdrop darkens slightly + intense blur */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/90 backdrop-blur-md z-1"
          />

          {/* 2. Interactive bright green glowing radial core background */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] bg-gradient-to-r from-emerald-500/20 to-primary/20 rounded-full blur-[130px] z-2 animate-pulse pointer-events-none" />

          {/* Sparkles / confetti stars randomly positioned around overlay bounds */}
          <div className="absolute inset-0 pointer-events-none z-3 overflow-hidden">
            {[...Array(15)].map((_, i) => {
              const x = Math.random() * 100;
              const y = Math.random() * 100;
              const delay = Math.random() * 1;
              const size = Math.random() * 6 + 4;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0, y: 15 }}
                  animate={{ 
                    opacity: [0, 0.8, 0], 
                    scale: [0.5, 1.2, 0.5],
                    y: [`${y}%`, `${y - 12}%`]
                  }}
                  transition={{ 
                    duration: 2 + Math.random() * 2, 
                    repeat: Infinity,
                    delay: delay
                  }}
                  style={{
                    position: 'absolute',
                    left: `${x}%`,
                    top: `${y}%`,
                    width: size,
                    height: size,
                    backgroundColor: '#FFCC00',
                    borderRadius: '50%',
                    boxShadow: '0 0 10px #FFCC00'
                  }}
                />
              );
            })}
          </div>

          {/* Main animated modal box */}
          <motion.div 
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="relative z-10 w-[92%] max-w-sm bg-surface-container rounded-[40px] border border-primary/30 p-8 shadow-2xl overflow-hidden text-center select-none"
          >
            {/* Ambient gold crown line accent */}
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-emerald-500 via-primary to-amber-500" />
            
            {/* Sparkles effect */}
            <div className="absolute -top-12 -right-12 w-36 h-36 bg-emerald-500/10 rounded-full blur-2xl" />

            <div className="space-y-6">
              {/* Giant Glowing Level badge */}
              <div className="relative inline-flex items-center justify-center">
                {/* 7. Expansion light ring */}
                <motion.div 
                  initial={{ scale: 0.6, opacity: 1 }}
                  animate={{ scale: 1.6, opacity: 0 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
                  className="absolute w-24 h-24 rounded-full border-2 border-primary/40"
                />
                
                <motion.div 
                  initial={{ rotate: -10, scale: 0.6 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ type: 'spring', delay: 0.1, damping: 12 }}
                  className="relative z-10 w-28 h-28 rounded-3xl bg-gradient-to-br from-emerald-500 via-primary to-amber-400 p-[2px] shadow-2xl flex items-center justify-center"
                >
                  <div className="w-full h-full bg-black/95 rounded-[26px] flex flex-col justify-center items-center">
                    <span className="text-[10px] text-emerald-400 font-extrabold uppercase leading-none tracking-[0.3em] mb-1">NOVO MARCO</span>
                    <span className="text-5xl font-black italic font-headline text-white leading-none">
                      {level}
                    </span>
                    <span className="text-[9px] text-primary font-black uppercase tracking-wider mt-1.5 bg-primary/10 border border-primary/20 px-2.5 py-0.5 rounded-full leading-none">
                      LEVEL UP
                    </span>
                  </div>
                </motion.div>
              </div>

              {/* Header Title */}
              <div className="space-y-1">
                <h2 className="text-[26px] font-black italic font-headline text-white uppercase tracking-tight leading-none">
                  EVOLUÇÃO MÁXIMA
                </h2>
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-xs font-black uppercase tracking-widest text-emerald-400">
                    CLASSIFICAÇÃO: {rankTitle.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Motivational Quotes */}
              <motion.p 
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-sm text-on-surface-variant font-medium leading-relaxed italic px-2 bg-white/[0.02] border border-white/[0.03] py-2.5 rounded-2xl"
              >
                "{quote}"
              </motion.p>

              {/* Premium Rewards / Prestige visual card */}
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="p-5 bg-gradient-to-b from-white/[0.04] to-transparent border border-white/5 rounded-3xl text-left space-y-3 shadow-inner relative"
              >
                <div className="flex items-center gap-2 text-primary">
                  <BadgeCheck size={16} className="text-emerald-400 shrink-0" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 leading-none">Evoluções de Prestígio Ativadas</span>
                </div>
                
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center text-[10px] font-black">
                      ★
                    </div>
                    <div>
                      <p className="font-extrabold text-white leading-none">Novo peso do Simulador de Força</p>
                      <p className="text-[10px] text-on-surface-variant font-medium mt-0.5">Seu halter de altar agora aumentou para <span className="text-emerald-400 font-bold">{barbellWeight} KG</span></p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-[10px] font-black">
                      ❖
                    </div>
                    <div>
                      <p className="font-extrabold text-white leading-none">Destaque temporário no Perfil</p>
                      <p className="text-[10px] text-on-surface-variant font-medium mt-0.5">Selo premium ativo nos rankings locais do INVICTUS</p>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Action Close */}
              <motion.button 
                initial={{ scale: 0.95 }}
                animate={{ scale: [0.95, 1, 0.95] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                onClick={onClose}
                className="w-full py-4 bg-gradient-to-r from-emerald-500 via-primary to-amber-500 hover:brightness-110 text-black rounded-2xl font-headline italic font-black text-sm uppercase tracking-widest transform transition-transform active:scale-[0.98] shadow-lg shadow-emerald-500/10 cursor-pointer"
              >
                REIVINDICAR ACADEMIA
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
