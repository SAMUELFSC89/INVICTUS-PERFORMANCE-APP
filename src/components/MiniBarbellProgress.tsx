import React from 'react';
import { motion } from 'motion/react';
import { ChevronUp, Zap, Sparkles } from 'lucide-react';
import { getBarbellWeight, getLevelTitle } from '../lib/levelUtils';

interface MiniBarbellProgressProps {
  level: number;
  percentage: number;
  onClick?: () => void;
}

export const MiniBarbellProgress: React.FC<MiniBarbellProgressProps> = ({ level, percentage, onClick }) => {
  const totalWeight = getBarbellWeight(level);
  const title = getLevelTitle(level);

  return (
    <div 
      onClick={onClick}
      className="flex flex-col w-[170px] md:w-[210px] select-none cursor-pointer group/mini active:scale-[0.98] transition-all"
      title={`Nível ${level} (${title}) - ${Math.round(percentage)}% XP`}
    >
      <div className="flex justify-between items-end mb-1 px-0.5">
        {/* Title Class (e.g. Invictus Rank, Determinado) with subtle tech feel */}
        <div className="flex flex-col">
          <span className="text-[7.5px] md:text-[8px] font-black tracking-[0.2em] text-primary uppercase leading-tight group-hover/mini:text-white transition-colors">
            {title} RANK
          </span>
          <span className="text-[8.5px] md:text-[9.5px] text-on-surface-variant font-extrabold uppercase leading-tight mt-0.5">
            {totalWeight} KG HALTER
          </span>
        </div>

        {/* Highlighted level label - Extremely highlighted and glowing */}
        <div className="flex items-center gap-1 bg-gradient-to-br from-primary/10 to-amber-500/10 border-2 border-primary/40 px-2 py-0.5 rounded-lg leading-none shadow-[0_0_12px_rgba(255,204,0,0.15)] group-hover/mini:border-primary/80 transition-all">
          <span className="text-[7px] font-black text-primary uppercase tracking-wider">LVL</span>
          <span className="text-xs md:text-sm font-black italic font-headline text-white leading-none">{level}</span>
        </div>
      </div>

      {/* Futuristic XP progress bar (Modern, Minimal, Premium, Dark Theme compatible) */}
      <div className="h-2.5 w-full bg-surface-container-highest p-[2px] rounded-full overflow-hidden border border-white/5 relative flex items-center shadow-inner">
        {/* Dynamic Glowing progress line */}
        <motion.div 
          className="h-full bg-gradient-to-r from-primary via-amber-400 to-orange-500 rounded-full relative"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          style={{
            boxShadow: '0 0 10px rgba(255, 204, 0, 0.4)'
          }}
        >
          {/* Subtle horizontal movement shimmer line */}
          <div className="absolute inset-0 bg-[linear-gradient(95deg,transparent_0%,rgba(255,255,255,0.4)_50%,transparent_100%)] w-2/3 h-full animate-[shimmer_2s_infinite]" />
        </motion.div>
        
        {/* Soft glowing aura under the bar */}
        <div className="absolute inset-0 rounded-full opacity-35 bg-primary/25 blur-[1.5px] pointer-events-none animate-pulse" />
      </div>

      {/* Bottom details of the mini level bar */}
      <div className="flex justify-between items-center text-[7.5px] font-black uppercase text-on-surface-variant/70 leading-none mt-1 px-0.5">
        <span>PRESTÍGIO</span>
        <span className="text-primary group-hover/mini:scale-105 transition-transform flex items-center gap-0.5 font-extrabold">
          {Math.round(percentage)}% XP <ChevronUp size={8} className="stroke-2 text-primary" />
        </span>
      </div>
    </div>
  );
};
