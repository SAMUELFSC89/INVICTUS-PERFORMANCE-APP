
import React, { useRef, useState } from 'react';
import { Share2, Download, Instagram, X, Trophy, Zap, Star, RefreshCw } from 'lucide-react';
import { toPng } from 'html-to-image';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { UserProfile } from '../types';

interface AchievementShareCardProps {
  user: UserProfile;
  achievement: {
    id: string;
    title: string;
    description: string;
    icon: string;
    rarity: 'common' | 'rare' | 'epic' | 'legendary';
  };
  onClose: () => void;
}

export function AchievementShareCard({ user, achievement, onClose }: AchievementShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const rarityConfig = {
    common: { color: 'text-on-surface-variant', bg: 'bg-surface-container-high', label: 'COMUM' },
    rare: { color: 'text-blue-400', bg: 'bg-blue-400/20', label: 'RARO' },
    epic: { color: 'text-purple-400', bg: 'bg-purple-400/20', label: 'ÉPICO' },
    legendary: { color: 'text-prize-gold', bg: 'bg-prize-gold/20', label: 'LENDÁRIO' }
  };

  const config = rarityConfig[achievement.rarity];

  const handleExport = async (format: 'stories' | 'feed') => {
    if (!cardRef.current) return;
    setIsGenerating(true);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      const width = 1080;
      const height = format === 'stories' ? 1920 : 1080;
      
      const dataUrl = await toPng(cardRef.current, {
        canvasWidth: width,
        canvasHeight: height,
        pixelRatio: 2,
      });

      const link = document.createElement('a');
      link.download = `moove-conquista-${achievement.id}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export Error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[500] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-6"
    >
      <div className="absolute top-6 right-6">
         <button onClick={onClose} className="p-3 bg-white/10 rounded-full text-white hover:bg-white/20 transition-all">
            <X size={24} />
         </button>
      </div>

      <div className="w-full flex-1 flex flex-col items-center justify-center gap-8 overflow-y-auto pt-12">
        {/* Hidden Exportable Card */}
        <div className="hidden">
           <div 
             ref={cardRef} 
             className="relative bg-black flex flex-col items-center justify-center overflow-hidden"
             style={{ 
               width: '1080px', 
               height: '1920px',
               background: 'linear-gradient(135deg, #0c0d10 0%, #1a1c23 100%)' 
             }}
           >
              {/* Background Decor */}
              <div className="absolute inset-0 opacity-40">
                <div className="absolute top-0 right-0 w-[1000px] h-[1000px] bg-primary/20 blur-[200px] rounded-full" />
                <div className="absolute bottom-0 left-0 w-[800px] h-[800px] bg-secondary/10 blur-[180px] rounded-full" />
              </div>

              <div className="relative z-10 w-full px-20 flex flex-col items-center text-center">
                 <div className="mb-20">
                    <span className="font-label text-3xl font-black text-white/40 tracking-[0.4em] uppercase">CONQUISTA DESBLOQUEADA</span>
                 </div>

                 <div className="relative mb-20">
                    <div className={cn("absolute -inset-10 blur-[100px] rounded-full opacity-40 animate-pulse", config.bg)} />
                    <div className="w-80 h-80 bg-white/5 border-4 border-white/10 rounded-[80px] flex items-center justify-center shadow-2xl relative z-10 backdrop-blur-3xl">
                       <span className="text-9xl">{achievement.icon}</span>
                    </div>
                 </div>

                 <div className="mb-32">
                    <div className={cn("inline-flex px-8 py-2 rounded-full font-black text-2xl uppercase tracking-[0.3em] mb-6", config.bg, config.color)}>
                       {config.label}
                    </div>
                    <h1 className="text-white font-black text-9xl uppercase tracking-tighter leading-none mb-6">{achievement.title}</h1>
                    <p className="text-white/40 text-4xl font-medium leading-tight max-w-3xl italic">"{achievement.description}"</p>
                 </div>

                 <div className="w-full bg-white/5 border border-white/10 rounded-[60px] p-16 flex items-center gap-10 backdrop-blur-xl">
                    <div className="w-32 h-32 rounded-3xl border-4 border-primary overflow-hidden">
                       <img src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} className="w-full h-full object-cover" alt="" />
                    </div>
                    <div className="text-left flex-1">
                       <p className="text-white font-black text-5xl uppercase tracking-tight mb-2">{user.displayName}</p>
                       <p className="text-white/40 text-2xl font-bold uppercase tracking-[0.2em]">atleta do cluster pro</p>
                    </div>
                    <div className="text-right">
                       <Zap className="text-primary fill-current ml-auto mb-2" size={48} />
                       <p className="text-white font-black text-3xl uppercase tracking-widest leading-none">INVICTUS PLAYER</p>
                    </div>
                 </div>
              </div>

              {/* Branding */}
              <div className="absolute bottom-20 flex flex-col items-center">
                 <p className="font-black tracking-[1em] text-4xl text-white opacity-20">INVICTUS.APP</p>
              </div>
           </div>
        </div>

        {/* Mobile Preview */}
        <div className="max-w-xs w-full aspect-[9/16] bg-surface-container rounded-[40px] overflow-hidden shadow-2xl border border-outline-variant/10 relative group">
           <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-secondary/5 opacity-50" />
           
           <div className="absolute inset-0 z-20 p-8 flex flex-col justify-between items-center text-center">
              <div className="w-full flex justify-between items-start">
                 <Zap className="text-primary fill-current" size={24} />
                 <span className="bg-white/10 text-white/60 px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest">Achievement card</span>
                 <Trophy className="text-prize-gold" size={20} />
              </div>

              <div className="space-y-6">
                 <div className="relative inline-block">
                    <div className={cn("absolute -inset-10 blur-3xl opacity-30 animate-pulse rounded-full", config.bg)} />
                    <div className="w-24 h-24 bg-white/10 border border-white/10 rounded-[32px] flex items-center justify-center relative z-10 shadow-xl backdrop-blur-xl">
                       <span className="text-5xl">{achievement.icon}</span>
                    </div>
                 </div>
                 <div>
                    <div className={cn("inline-flex px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest mb-2", config.bg, config.color)}>
                       {config.label}
                    </div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter leading-none mb-1">{achievement.title}</h2>
                    <p className="text-[10px] font-medium text-white/40 italic leading-snug truncate max-w-[200px]">{achievement.description}</p>
                 </div>
              </div>

              <div className="w-full bg-black/40 backdrop-blur-xl rounded-3xl p-4 border border-white/5 flex items-center gap-3">
                 <div className="w-10 h-10 rounded-xl border border-primary/40 overflow-hidden shrink-0">
                    <img src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} className="w-full h-full object-cover" alt="" />
                 </div>
                 <div className="text-left flex-1">
                    <p className="text-[10px] font-black text-white uppercase tracking-tight">{user.displayName}</p>
                    <p className="text-[8px] font-bold text-white/40 uppercase tracking-widest leading-none">INVICTUS Athlete</p>
                 </div>
              </div>

              <div className="space-y-1">
                 <p className="font-black tracking-[0.5em] text-[8px] text-white opacity-40">INVICTUS.APP</p>
              </div>
           </div>
        </div>

        {/* Action Buttons */}
        <div className="w-full max-w-sm space-y-4">
           <button 
             onClick={() => handleExport('stories')}
             disabled={isGenerating}
             className="w-full bg-primary text-black py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl flex items-center justify-center gap-3 disabled:opacity-50"
           >
              {isGenerating ? <RefreshCw className="animate-spin" size={20} /> : <Instagram size={20} />} Postar no Instagram
           </button>

           <button 
             onClick={() => handleExport('feed')}
             disabled={isGenerating}
             className="w-full bg-surface-container-high text-on-surface py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] border border-outline-variant/10 flex items-center justify-center gap-3 disabled:opacity-50"
           >
              {isGenerating ? <RefreshCw className="animate-spin" size={20} /> : <Download size={20} />} Baixar Imagem
           </button>

           <button 
             onClick={onClose}
             className="w-full text-white/40 font-black text-[10px] uppercase tracking-[0.3em] py-4"
           >
              SAIR DA CONQUISTA
           </button>
        </div>
      </div>
    </motion.div>
  );
}
