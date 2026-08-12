import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles } from 'lucide-react';

interface XPGain {
  id: string;
  points: number;
}

interface FloatingXPIndicatorProps {
  xpGain: XPGain | null;
  onComplete: () => void;
}

export function FloatingXPIndicator({ xpGain, onComplete }: FloatingXPIndicatorProps) {
  useEffect(() => {
    if (xpGain) {
      const timer = setTimeout(() => {
        onComplete();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [xpGain, onComplete]);

  return (
    <AnimatePresence>
      {xpGain && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[100] pointer-events-none select-none">
          <motion.div
            initial={{ opacity: 0, y: 35, scale: 0.8 }}
            animate={{ 
              opacity: [0, 1, 1, 0], 
              y: [35, -20, -50, -80],
              scale: [0.8, 1.1, 1, 0.9]
            }}
            transition={{ duration: 2.2, ease: [0.19, 1, 0.22, 1] }}
            className="flex items-center gap-1 bg-gradient-to-r from-primary/95 to-amber-500/95 border border-primary/40 px-4 py-2 rounded-full shadow-2xl backdrop-blur-md"
          >
            <Sparkles size={14} className="text-black animate-pulse" />
            <span className="font-headline italic font-black text-sm text-black uppercase tracking-wider">
              +{xpGain.points} XP
            </span>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
