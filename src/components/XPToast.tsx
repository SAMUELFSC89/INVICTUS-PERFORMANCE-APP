import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TrendingUp, Trophy, Star } from 'lucide-react';

interface XPToastProps {
  points: number;
  message?: string;
  rankingPoints?: number;
  isVisible: boolean;
  onComplete: () => void;
}

export const XPToast: React.FC<XPToastProps> = ({ points, message, rankingPoints, isVisible, onComplete }) => {
  const hasRankingPoints = rankingPoints !== undefined && rankingPoints !== null;
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.8 }}
          animate={{ opacity: 1, y: -20, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5, y: -100 }}
          onAnimationComplete={() => {
            setTimeout(onComplete, 2000);
          }}
          className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
        >
          <div className="bg-primary text-on-primary px-6 py-4 rounded-3xl shadow-2xl flex flex-col items-center gap-1 border-4 border-white/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center animate-pulse">
                {hasRankingPoints ? <Trophy size={22} className="fill-white" /> : <Star size={24} className="fill-white" />}
              </div>
              <div className="flex flex-col">
                {hasRankingPoints ? (
                  <>
                    <span className="font-headline italic font-black text-2xl leading-none">+{rankingPoints} PTS</span>
                    <span className="font-label text-[10px] font-black uppercase tracking-widest opacity-80">PONTOS DE RANKING GANHOS!</span>
                    {points > 0 && (
                      <span className="font-label text-[9px] font-bold uppercase tracking-wider opacity-70 mt-0.5">+{points} XP</span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="font-headline italic font-black text-2xl leading-none">+{points} XP</span>
                    <span className="font-label text-[10px] font-black uppercase tracking-widest opacity-80">PONTOS GANHOS!</span>
                  </>
                )}
              </div>
            </div>
            {message && (
              <div className="mt-2 px-3 py-1 bg-black/20 rounded-full">
                <span className="font-label text-[8px] font-bold uppercase tracking-tighter whitespace-nowrap">{message}</span>
              </div>
            )}
            
            {/* Particles simulation with CSS */}
            <div className="absolute inset-0 pointer-events-none overflow-visible">
               {[...Array(6)].map((_, i) => (
                 <motion.div
                   key={i}
                   initial={{ opacity: 0, scale: 0 }}
                   animate={{ 
                     opacity: [0, 1, 0], 
                     scale: [0, 1.5, 0],
                     x: (i % 2 === 0 ? 1 : -1) * (20 + i * 10),
                     y: -40 - i * 5
                   }}
                   transition={{ duration: 0.8, delay: i * 0.1 }}
                   className="absolute left-1/2 top-1/2"
                 >
                   <Star size={12} className="text-prize-gold fill-prize-gold" />
                 </motion.div>
               ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
