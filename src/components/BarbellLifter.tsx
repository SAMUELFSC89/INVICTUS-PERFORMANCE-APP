import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Flame, Sparkles, Volume2, VolumeX, Zap } from 'lucide-react';
import { getBarbellWeight, getXPProgress } from '../lib/levelUtils';
import { useUser } from '../UserContext';

interface BarbellLifterProps {
  level: number;
}

interface PlateConfig {
  weight: number;
  color: string;
  width: number;
  height: number;
  glowColor?: string;
}

// Top Olympic Plate standards
const PREMIUM_PLATES: PlateConfig[] = [
  { weight: 25, color: '#EF4444', width: 4, height: 38, glowColor: 'rgba(239, 68, 68, 0.4)' },    // Red
  { weight: 20, color: '#3B82F6', width: 3.6, height: 34, glowColor: 'rgba(59, 130, 246, 0.4)' },  // Blue
  { weight: 15, color: '#EAB308', width: 3.2, height: 30, glowColor: 'rgba(234, 179, 8, 0.4)' },   // Yellow
  { weight: 10, color: '#22C55E', width: 2.8, height: 26, glowColor: 'rgba(34, 197, 94, 0.4)' },   // Green
  { weight: 5, color: '#F3F4F6', width: 2.2, height: 21 },                                        // White
  { weight: 2.5, color: '#111827', width: 1.6, height: 16 },                                       // Black
  { weight: 1, color: '#6B7280', width: 1.2, height: 12 }                                         // Grey
];

function getPlatesList(totalWeight: number): PlateConfig[] {
  const barWeight = totalWeight <= 15 ? 5 : 15;
  const sideWeight = Math.max(0, (totalWeight - barWeight) / 2);
  
  const plates: PlateConfig[] = [];
  let remaining = sideWeight;
  
  for (const plate of PREMIUM_PLATES) {
    while (remaining >= plate.weight) {
      if (plates.length >= 7) break; // Visual stack limit
      plates.push(plate);
      remaining -= plate.weight;
    }
  }
  
  if (remaining > 0 && plates.length < 7) {
    plates.push(PREMIUM_PLATES[PREMIUM_PLATES.length - 1]);
  }
  
  return plates;
}

type LiftStage = 'idle' | 'ready' | 'first-pull' | 'clean-catch' | 'overhead-press' | 'triumph';

export const BarbellLifter: React.FC<BarbellLifterProps> = ({ level }) => {
  const { user } = useUser();
  const userXP = user?.xp || 0;
  const progress = getXPProgress(userXP);

  const [stage, setStage] = useState<LiftStage>('idle');
  const [isLifting, setIsLifting] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const currentLevelWeight = getBarbellWeight(level);
  const platesList = getPlatesList(currentLevelWeight);

  // Manual performance simulation lift lifecycle
  const runLiftCycle = async () => {
    if (isLifting) return;
    setIsLifting(true);
    
    setStage('ready');
    await wait(700);
    
    setStage('first-pull');
    await wait(800);
    
    setStage('clean-catch');
    await wait(900);
    
    setStage('overhead-press');
    await wait(1000);
    
    setStage('triumph');
    await wait(2400);
    
    setStage('idle');
    setIsLifting(false);
  };

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Audio synthesis triggers matching specific stages
  const playBeep = (freq: number, type: OscillatorType, duration: number, delay = 0) => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      }, delay);
    } catch (e) {
      console.warn('Web Audio error:', e);
    }
  };

  useEffect(() => {
    if (!soundEnabled) return;
    if (stage === 'ready') {
      playBeep(220, 'sine', 0.2);
    } else if (stage === 'first-pull') {
      playBeep(290, 'triangle', 0.25);
    } else if (stage === 'clean-catch') {
      playBeep(390, 'square', 0.12);
    } else if (stage === 'overhead-press') {
      playBeep(580, 'triangle', 0.3);
    } else if (stage === 'triumph') {
      playBeep(523, 'sine', 0.12, 0);
      playBeep(659, 'sine', 0.12, 100);
      playBeep(784, 'sine', 0.12, 200);
      playBeep(1046, 'sine', 0.35, 300);
    }
  }, [stage, soundEnabled]);

  // Handle stage based elevation
  // When idle, the barbell's elevation is linked EXACTLY to XP progress (percentage)
  // When lifting manual test, it rises from the floor dynamically through stages
  const getElevatedY = () => {
    if (isLifting) {
      switch (stage) {
        case 'ready': return 115;       // Resting setup
        case 'first-pull': return 85;    // Hip high
        case 'clean-catch': return 55;   // Racked on chest
        case 'overhead-press': return 30; // Raising overhead
        case 'triumph': return 12;       // Maximum extension
        default: return 115;
      }
    }
    // Idle state: physically linked to the current level progress percentage
    // 0% progress -> Y = 115 (floor)
    // 100% progress -> Y = 15 (fully overhead ceiling)
    const minY = 115;
    const maxY = 22;
    return minY - (progress.percentage / 100) * (minY - maxY);
  };

  const barY = getElevatedY();

  return (
    <div className="bg-gradient-to-b from-surface-container-low to-surface-container/90 rounded-[28px] border border-white/[0.06] p-5 shadow-2xl relative overflow-hidden flex flex-col items-center select-none w-full">
      {/* Visual background grids */}
      <div className="absolute inset-0 bg-grid-white/[0.015] pointer-events-none" />
      <div className="absolute -top-12 -left-12 w-32 h-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" />

      {/* Modern High-End Layout Header */}
      <div className="w-full flex justify-between items-center z-10 mb-4 pb-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20 text-primary animate-pulse">
            <Flame size={14} className="fill-primary" />
          </div>
          <div>
            <span className="text-[7px] font-black tracking-widest text-[#FC4C02] uppercase leading-none block">INVICTUS LEVEL SYSTEM</span>
            <h3 className="font-headline italic font-black text-xs md:text-sm text-white uppercase tracking-tight">STATUS DE FORÇA REAL</h3>
          </div>
        </div>

        {/* Audio feedback config */}
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className={`p-1.5 rounded-lg border transition-all ${
            soundEnabled 
              ? "bg-[#FC4C02]/15 border-[#FC4C02]/30 text-[#FC4C02] shadow-[0_0_8px_rgba(252,76,2,0.15)]" 
              : "bg-white/5 border-white/5 text-on-surface-variant/50 hover:text-white"
          }`}
          title={soundEnabled ? "Desativar áudio" : "Ativar áudio"}
        >
          {soundEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
        </button>
      </div>

      {/* GRAND SPLIT PANEL: Halter (Current weight) vs Barra (Lifting Elevation Progress) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 w-full z-10">
        
        {/* LEFT COLUMN: THE DUMBBELL (HALTER) REPRESENTING USER LEVEL */}
        <div className="md:col-span-5 bg-black/60 rounded-2xl border border-white/[0.05] p-3 flex flex-col justify-between items-center relative overflow-hidden">
          {/* Subtle beam */}
          <div className="absolute inset-0 bg-gradient-to-t from-primary/[0.03] to-transparent pointer-events-none" />
          
          <div className="text-center">
            <span className="text-[7px] font-bold text-on-surface-variant/60 uppercase tracking-widest">O HÁLTER INDICA</span>
            <h4 className="font-headline italic font-black text-xs md:text-sm text-primary uppercase">O SEU NÍVEL ATUAL</h4>
          </div>

          {/* Dumbbell Render Area with float animation */}
          <div className="h-32 flex items-center justify-center w-full relative">
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut" }}
              className="relative flex flex-col items-center"
            >
              {/* Complex Vector Dumbbell (Haltere) with chrome style */}
              <svg viewBox="0 0 100 60" className="w-32 h-24 overflow-visible drop-shadow-[0_8px_16px_rgba(0,0,0,0.8)]">
                <defs>
                  <linearGradient id="chromeDumbbell" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#FFFFFF" />
                    <stop offset="40%" stopColor="#9CA3AF" />
                    <stop offset="60%" stopColor="#4B5563" />
                    <stop offset="100%" stopColor="#1F2937" />
                  </linearGradient>
                  
                  <linearGradient id="heavyGoldPlate" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#FFE066" />
                    <stop offset="30%" stopColor="#FFCC00" />
                    <stop offset="70%" stopColor="#E6B800" />
                    <stop offset="100%" stopColor="#806600" />
                  </linearGradient>
                </defs>

                {/* Central Metallic Handle gripped in the core */}
                <rect x="25" y="27" width="50" height="6" fill="url(#chromeDumbbell)" rx="1.5" stroke="#111827" strokeWidth="0.5" />
                <rect x="40" y="26.3" width="20" height="7.4" fill="#374151" rx="1" stroke="#9CA3AF" strokeWidth="0.3" strokeDasharray="0.5 0.5" />

                {/* Left plate array stacking representing level heftiness */}
                <g>
                  {/* Heavy Base plate */}
                  <rect x="18" y="10" width="8" height="40" fill={level >= 10 ? "url(#heavyGoldPlate)" : "#1F2937"} rx="1.5" stroke="#111827" strokeWidth="0.8" />
                  <line x1="22" y1="12" x2="22" y2="48" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />

                  {/* Progressive extra plate 2 */}
                  {level >= 3 && (
                    <>
                      <rect x="11" y="14" width="7" height="32" fill="#3B82F6" rx="1.2" stroke="#111827" strokeWidth="0.8" />
                      <line x1="14.5" y1="16" x2="14.5" y2="44" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
                    </>
                  )}

                  {/* Progressive extra plate 3 */}
                  {level >= 8 && (
                    <>
                      <rect x="5" y="18" width="6" height="24" fill="#EF4444" rx="1" stroke="#111827" strokeWidth="0.8" />
                    </>
                  )}
                  
                  {/* Outer collar bolt */}
                  <rect x="2" y="25" width="3" height="10" fill="#9CA3AF" rx="0.5" stroke="#111827" strokeWidth="0.4" />
                </g>

                {/* Right plate array stacking representing level heftiness */}
                <g>
                  {/* Heavy Base plate */}
                  <rect x="74" y="10" width="8" height="40" fill={level >= 10 ? "url(#heavyGoldPlate)" : "#1F2937"} rx="1.5" stroke="#111827" strokeWidth="0.8" />
                  <line x1="78" y1="12" x2="78" y2="48" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />

                  {/* Progressive extra plate 2 */}
                  {level >= 3 && (
                    <>
                      <rect x="82" y="14" width="7" height="32" fill="#3B82F6" rx="1.2" stroke="#111827" strokeWidth="0.8" />
                      <line x1="85.5" y1="16" x2="85.5" y2="44" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
                    </>
                  )}

                  {/* Progressive extra plate 3 */}
                  {level >= 8 && (
                    <>
                      <rect x="89" y="18" width="6" height="24" fill="#EF4444" rx="1" stroke="#111827" strokeWidth="0.8" />
                    </>
                  )}

                  {/* Outer collar bolt */}
                  <rect x="95" y="25" width="3" height="10" fill="#9CA3AF" rx="0.5" stroke="#111827" strokeWidth="0.4" />
                </g>
              </svg>
              
              {/* Internal glow aura matching athlete tier */}
              <div className="absolute inset-0 bg-primary/5 blur-xl w-16 h-16 rounded-full self-center top-4" />
            </motion.div>
          </div>

          <div className="text-center w-full bg-white/[0.03] p-2 rounded-xl border border-white/[0.04]">
            <div className="flex items-center justify-center gap-1.5">
              <span className="font-headline italic font-black text-sm text-white">NÍVEL {level}</span>
              <span className="text-[8px] bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 rounded font-black tracking-tight uppercase">
                {currentLevelWeight} KG
              </span>
            </div>
            <p className="text-[7.5px] text-on-surface-variant/70 uppercase font-semibold mt-0.5">Peso equivalente no simulador</p>
          </div>
        </div>

        {/* RIGHT COLUMN: THE BARBELL (A BARRA) RAISING CORRESPONDING TO PROGRESS PERCENTAGE */}
        <div className="md:col-span-7 bg-black/60 rounded-2xl border border-white/[0.05] p-3 flex flex-col justify-between relative overflow-hidden">
          
          <div className="text-center mb-1">
            <span className="text-[7px] font-bold text-on-surface-variant/60 uppercase tracking-widest">A BARRA DE PRODUTIVIDADE</span>
            <h4 className="font-headline italic font-black text-xs md:text-sm text-primary uppercase">
              {isLifting ? "EXERCÍCIO DE FORÇA EM ANDAMENTO" : "PROGREDIR ATÉ LEVEL " + progress.nextLevel}
            </h4>
          </div>

          {/* LARGE BARBELL ELEVATION SCENE ("A barra levanta conforme você ganha XP") */}
          <div className="h-40 relative bg-black/50 border border-white/[0.03] rounded-xl overflow-hidden flex items-center justify-center">
            
            {/* Height target markings on background showing professional benchmarks */}
            <div className="absolute inset-x-2 top-3 flex items-center justify-between opacity-30">
              <span className="text-[6px] font-mono text-primary font-bold">🎯 OVERHEAD MAX (100% XP)</span>
              <div className="flex-grow mx-2 border-t border-dashed border-primary/40 h-[1.5px]" />
              <span className="text-[5.5px] font-mono text-on-surface-variant">CEILING</span>
            </div>

            <div className="absolute inset-x-2 top-[55%] flex items-center justify-between opacity-25">
              <span className="text-[6px] font-mono text-white">🏋️ CHEST POSITION (CLEAN)</span>
              <div className="flex-grow mx-2 border-t border-dashed border-white/20 h-[1.5px]" />
              <span className="text-[5.5px] font-mono text-on-surface-variant">HALF</span>
            </div>

            {/* Heavy lifting rubber platform at the floor */}
            <div className="absolute bottom-0 inset-x-1 h-3.5 bg-gradient-to-t from-zinc-900 via-zinc-800 to-zinc-900 border-t border-white/[0.15] rounded-t-sm flex items-center justify-center">
              <div className="w-[85%] h-[1.5px] bg-[#FC4C02]/20 shadow-[0_0_8px_rgba(252,76,2,0.3)]" />
            </div>

            {/* Glowing background heat columns pushing the bar */}
            {!isLifting && (
              <div 
                className="absolute bottom-2 bg-gradient-to-t from-primary/[0.01] via-primary/[0.08] to-transparent w-40 transition-all duration-500 ease-out pointer-events-none"
                style={{ height: `${progress.percentage}%` }}
              />
            )}

            {/* ACTIVE CELEBRATION SPARKLES */}
            <AnimatePresence>
              {(stage === 'triumph' || (!isLifting && progress.percentage > 85)) && (
                <div className="absolute inset-0 pointer-events-none z-10">
                  {[...Array(4)].map((_, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, scale: 0, y: barY }}
                      animate={{ 
                        opacity: [0, 1, 0], 
                        scale: [0.5, 1.2, 0.4],
                        x: 50 + (Math.sin(i * 90) * 45),
                        y: barY - 20 - (Math.random() * 20)
                      }}
                      transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.3 }}
                      className="absolute"
                    >
                      <Sparkles size={11} className="text-primary fill-primary" />
                    </motion.div>
                  ))}
                </div>
              )}
            </AnimatePresence>

            {/* SVG STAGE FOR THE FULL-SIZE OLYMPIC BARBELL LIFT ("A BARRA") */}
            <svg viewBox="0 0 150 140" className="w-full h-full overflow-visible relative">
              {/* Vertical Guide cables representation */}
              <line x1="22" y1="10" x2="22" y2="125" stroke="rgba(255,255,255,0.025)" strokeWidth="1" strokeDasharray="2 2" />
              <line x1="128" y1="10" x2="128" y2="125" stroke="rgba(255,255,255,0.025)" strokeWidth="1" strokeDasharray="2 2" />

              {/* BARBELL (ALTAR) SVG GROUP */}
              <motion.g
                animate={{ 
                  y: barY - 70, // Aligning to base SVG height logic
                  rotate: isLifting && stage === 'overhead-press' ? [0, -1, 1, 0] : 0
                }}
                transition={{ type: "spring", stiffness: 120, damping: 13 }}
              >
                {/* Thick glowing metallic bar shaft */}
                <line 
                  x1="18" 
                  y1="70" 
                  x2="132" 
                  y2="70" 
                  stroke={isLifting ? "#FFFFFF" : "#FFCC00"} 
                  strokeWidth="2.8" 
                  strokeLinecap="round" 
                  className="drop-shadow-[0_3px_6px_rgba(0,0,0,0.8)]"
                />

                {/* Laser energy line of progress physically engraved inside the steel shaft */}
                {!isLifting && (
                  <line 
                    x1="45" 
                    y1="70" 
                    x2={45 + (105 - 45) * (progress.percentage / 100)} 
                    y2="70" 
                    stroke="#FFFFFF" 
                    strokeWidth="1.2" 
                    strokeLinecap="round"
                  />
                )}

                {/* Knurled steel grip marks */}
                <line x1="45" y1="70" x2="52" y2="70" stroke="#4B5563" strokeWidth="3" strokeDasharray="0.8 0.8" />
                <line x1="68" y1="70" x2="82" y2="70" stroke="#4B5563" strokeWidth="3" strokeDasharray="0.8 0.8" />
                <line x1="98" y1="70" x2="105" y2="70" stroke="#4B5563" strokeWidth="3" strokeDasharray="0.8 0.8" />

                {/* Left Collar stopper */}
                <circle cx="34" cy="70" r="3.5" fill="#374151" stroke="#9CA3AF" strokeWidth="0.5" />
                
                {/* Right Collar stopper */}
                <circle cx="116" cy="70" r="3.5" fill="#374151" stroke="#9CA3AF" strokeWidth="0.5" />

                {/* LEFT SIDE OLYMPIC PLATE STACKS */}
                <g>
                  {platesList.map((plate, idx) => {
                    // Stacking outwards from center collar X=33
                    const offset = 32 - (idx * 2.8) - plate.width;
                    return (
                      <g key={`l-op-${idx}`}>
                        <rect
                          x={offset}
                          y={70 - plate.height / 2}
                          width={plate.width}
                          height={plate.height}
                          fill={plate.color}
                          rx="1.2"
                          stroke="#000000"
                          strokeWidth="0.6"
                          className="drop-shadow-[1px_2px_3px_rgba(0,0,0,0.6)]"
                          style={{ filter: plate.glowColor ? `drop-shadow(0 0 2px ${plate.glowColor})` : undefined }}
                        />
                        {/* Chrome radial inner circle highlight on plates */}
                        <line x1={offset + plate.width / 2} y1={70 - plate.height / 3} x2={offset + plate.width / 2} y2={70 + plate.height / 3} stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />
                      </g>
                    );
                  })}
                </g>

                {/* RIGHT SIDE OLYMPIC PLATE STACKS */}
                <g>
                  {platesList.map((plate, idx) => {
                    // Stacking outwards from center collar X=117
                    const offset = 118 + (idx * 2.8);
                    return (
                      <g key={`r-op-${idx}`}>
                        <rect
                          x={offset}
                          y={70 - plate.height / 2}
                          width={plate.width}
                          height={plate.height}
                          fill={plate.color}
                          rx="1.2"
                          stroke="#000000"
                          strokeWidth="0.6"
                          className="drop-shadow-[1px_2px_3px_rgba(0,0,0,0.6)]"
                          style={{ filter: plate.glowColor ? `drop-shadow(0 0 2px ${plate.glowColor})` : undefined }}
                        />
                        {/* Chrome radial inner circle highlight on plates */}
                        <line x1={offset + plate.width / 2} y1={70 - plate.height / 3} x2={offset + plate.width / 2} y2={70 + plate.height / 3} stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />
                      </g>
                    );
                  })}
                </g>

                {/* Protective edge clips wrapping plates together */}
                {platesList.length > 0 && (
                  <>
                    <rect x={31.5 - platesList.length * 2.8 - 1} y="68" width="1" height="4" fill="#6B7280" stroke="#111827" strokeWidth="0.2" />
                    <rect x={118.5 + platesList.length * 2.8} y="68" width="1" height="4" fill="#6B7280" stroke="#111827" strokeWidth="0.2" />
                  </>
                )}
              </motion.g>
            </svg>

            {/* Glowing bottom dynamic indicator label bar ("A barra representa o nível / progresso") */}
            <div className="absolute bottom-5 right-4 p-1.5 bg-black/60 backdrop-blur-md border border-white/5 rounded-lg flex items-center gap-1">
              <Zap size={10} className="text-primary" />
              <span className="font-mono text-[8px] text-white font-bold uppercase">
                {isLifting ? "ALTURA SIMULADA" : `ELEVADA EM ${Math.round(progress.percentage)}%`}
              </span>
            </div>
          </div>

          {/* Glowing bottom neon line indicating the progress inside the container */}
          <div className="mt-1 flex flex-col gap-1 w-full p-2 bg-gradient-to-r from-white/[0.01] via-white/[0.04] to-white/[0.01] rounded-xl border border-white/[0.03]">
            <div className="flex justify-between items-center text-[8px] font-black uppercase text-on-surface-variant/70 tracking-wider">
              <span>NÍVEL {level}</span>
              <span className="text-primary italic animate-pulse">UP: {Math.round(progress.percentage)}%</span>
              <span>NÍVEL {progress.nextLevel}</span>
            </div>
            
            {/* The actual progress horizontal bar: highly refined, custom animated styling */}
            <div className="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden border border-white/5 relative flex items-center">
              <motion.div 
                className="h-full bg-gradient-to-r from-primary via-alert-orange to-primary rounded-full relative shadow-[0_0_8px_rgba(255,204,0,0.5)]"
                initial={{ width: 0 }}
                animate={{ width: `${progress.percentage}%` }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              >
                {/* Scanning active light line */}
                <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.4)_50%,transparent_100%)] w-2/3 h-full animate-[shimmer_2s_infinite]" />
              </motion.div>
            </div>
            
            <div className="flex justify-between items-center text-[7.5px] font-bold text-on-surface-variant/55 uppercase">
              <span>{userXP.toLocaleString()} XP</span>
              <span className="text-primary tracking-tight">FALTA {Math.max(0, progress.xpCeiling - userXP).toLocaleString()} XP</span>
              <span>{progress.xpCeiling.toLocaleString()} XP</span>
            </div>
          </div>
        </div>

      </div>

      {/* FOOTER ACTION PANEL & SOUND TRACK SIMULATION */}
      <div className="w-full mt-4 flex flex-col gap-3 pt-3 border-t border-white/[0.04] z-10">
        
        {/* Helper status prompt */}
        <div className="w-full text-center bg-black/40 py-2 px-3 rounded-xl border border-white/[0.03]">
          <span className="text-[9px] font-mono font-black uppercase text-primary tracking-widest block transition-all min-h-[14px]">
            {isLifting ? (
              stage === 'ready' ? 'PRONTO PARA ENTRAR NA POSIÇÃO DE ARRANQUE... 🏋️‍♂️' :
              stage === 'first-pull' ? 'PUXADA INICIAL COMPLETA (ATÉ A CINTURA!) ⚡' :
              stage === 'clean-catch' ? 'ARRANQUE E SUPORTE NOS OMBROS! RACK CATCH! 🚀' :
              stage === 'overhead-press' ? 'DESENVOLVIMENTO ACIMA DA CABEÇA! OVERHEAD PRESS! 🔥' :
              `SIMULAÇÃO DE SUCESSO COMPLETO! ${currentLevelWeight} KG CONCLUÍDOS! 🎉`
            ) : "A ALTURA DA BARRA ACOMPANHA SEU XP REAL PARA O PRÓXIMO NÍVEL."}
          </span>
        </div>

        {/* Action Button to play dynamic lift simulation */}
        <button
          onClick={runLiftCycle}
          disabled={isLifting}
          className={`h-12 w-full rounded-xl font-headline italic font-black text-xs uppercase tracking-widest transition-all ${
            isLifting 
              ? "bg-surface-container-highest border border-white/5 text-on-surface-variant cursor-not-allowed opacity-50" 
              : "bg-gradient-to-r from-primary to-alert-orange text-black hover:opacity-95 active:scale-[0.98] shadow-lg shadow-primary/10"
          } flex items-center justify-center gap-1.5`}
        >
          {isLifting ? (
            <span className="animate-pulse">SIMULANDO LEVANTAMENTO DA BARRA...</span>
          ) : (
            <>
              <span>TESTAR FORÇA COMPLETA ({currentLevelWeight}KG)</span>
              <ArrowRight size={14} className="animate-bounce-horizontal" />
            </>
          )}
        </button>

        {/* Dynamic regulatory guide footer panel */}
        <div className="flex justify-between items-center text-[7px] text-on-surface-variant/45 uppercase tracking-wider font-semibold">
          <span>MIN: 8KG (LVL 1)</span>
          <span>DIFICULDADE PROGRESSIVA DE ATLETAS INVICTUS</span>
          <span>MAX: 220KG (LVL 100)</span>
        </div>
      </div>
    </div>
  );
};
