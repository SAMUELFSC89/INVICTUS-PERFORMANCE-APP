
import React, { useRef, useState } from 'react';
import { Share2, Download, Instagram, X, Trophy, Zap, Crown, Target, Sparkles, RefreshCw } from 'lucide-react';
import { toPng } from 'html-to-image';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { UserProfile } from '../types';

interface RankingShareCardProps {
  user: UserProfile;
  rankingType: 'gym' | 'city' | 'global';
  period: 'all' | 'weekly' | 'monthly';
  onClose: () => void;
}

export function RankingShareCard({ user, rankingType, period, onClose }: RankingShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const rank = rankingType === 'gym' ? (user.positions?.gym || '-') : 
               rankingType === 'city' ? (user.positions?.city || '-') : 
               (user.positions?.national || '-');
               
  const score = period === 'weekly' ? user.weeklyScore : 
                period === 'monthly' ? user.monthlyScore : 
                user.score;

  const rankingLabel = rankingType === 'gym' ? 'NA ACADEMIA' : 
                      rankingType === 'city' ? 'NA CIDADE' : 
                      'NO BRASIL';

  const periodLabel = period === 'weekly' ? 'DA SEMANA' : 
                     period === 'monthly' ? 'DO MÊS' : 
                     'GERAL';

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
      link.download = `moove-ranking-${rankingType}-${rank}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export Error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleShareSystem = async () => {
    const text = `Estou no Top ${rank} ${rankingLabel} do INVICTUS! 🔥 Desafie seus limites e venha competir comigo. #INVICTUS #ranking #fitness`;
    const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
    const url = baseUrl.replace(/\/$/, '');
    
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Meu Ranking no INVICTUS', text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        alert('Copiado para área de transferência!');
      }
    } catch (err) {
      console.error('Share error:', err);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[500] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-6"
    >
      <div className="absolute top-6 right-6 flex items-center gap-4">
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
               background: 'linear-gradient(135deg, #0c0d10 0%, #16181d 100%)' 
             }}
           >
              {/* Decorative Elements */}
              <div className="absolute inset-0 opacity-40">
                <div className="absolute top-0 right-0 w-[900px] h-[900px] bg-primary/20 blur-[180px] rounded-full" />
                <div className="absolute bottom-0 left-0 w-[700px] h-[700px] bg-tertiary/10 blur-[150px] rounded-full" />
              </div>

              {/* Grid with numbers */}
              <div className="absolute inset-0 opacity-[0.03] text-white flex flex-wrap gap-10 font-headline italic font-black text-9xl leading-none overflow-hidden p-10 select-none">
                 {Array.from({ length: 20 }).map((_, i) => <span key={i} className="transform rotate-12">{i + 1}</span>)}
              </div>

              {/* Main Content */}
              <div className="relative z-10 w-full px-20 flex flex-col items-center text-center">
                 <div className="mb-20">
                    <div className="w-32 h-32 bg-primary/20 rounded-3xl flex items-center justify-center mb-6">
                       <Zap className="text-primary fill-current" size={64} />
                    </div>
                    <span className="font-label text-3xl font-black text-white/40 tracking-[0.4em] uppercase">STATUS DA ARENA</span>
                 </div>

                 <div className="space-y-4 mb-24">
                    <h2 className="text-white/60 font-black text-4xl uppercase tracking-[0.2em]">RANKING {periodLabel}</h2>
                    <div className="relative inline-block">
                       <div className="absolute -inset-10 bg-primary/40 blur-[100px] rounded-full opacity-50" />
                       <h1 className="text-[350px] font-black italic tracking-tight leading-none text-white relative flex items-start gap-4">
                         <span className="text-8xl mt-16 mt-20 opacity-30">#</span>
                         {rank}
                       </h1>
                    </div>
                    <p className="text-primary font-black text-6xl uppercase tracking-tighter italic money-glow">{rankingLabel}</p>
                 </div>

                 <div className="w-full bg-white/5 border border-white/10 rounded-[60px] p-16 space-y-10 mb-20 backdrop-blur-xl">
                    <div className="flex items-center gap-10">
                       <div className="w-32 h-32 rounded-3xl border-4 border-primary overflow-hidden shadow-2xl">
                          <img src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} className="w-full h-full object-cover" alt="" />
                       </div>
                       <div className="text-left flex-1">
                          <p className="text-white font-black text-5xl uppercase tracking-tight mb-2">{user.displayName}</p>
                          <p className="text-white/40 text-2xl font-bold uppercase tracking-[0.2em]">atleta do cluster pro</p>
                       </div>
                       <div className="text-right">
                          <p className="text-primary font-black text-7xl italic leading-none">{score?.toLocaleString()}</p>
                          <p className="text-white/40 text-xl font-black uppercase tracking-[0.2em]">XP ACUMULADO</p>
                       </div>
                    </div>
                 </div>

                 <div className="flex items-center gap-10">
                    <div className="flex flex-col items-center gap-2">
                       <Crown size={60} className="text-prize-gold drop-shadow-[0_0_20px_rgba(255,215,0,0.4)]" />
                       <span className="text-white/40 font-black text-sm tracking-widest">TOP RANK</span>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                    <div className="flex flex-col items-center gap-2">
                       <Target size={60} className="text-primary" />
                       <span className="text-white/40 font-black text-sm tracking-widest">VALIDADO</span>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                    <div className="flex flex-col items-center gap-2">
                       <Sparkles size={60} className="text-tertiary" />
                       <span className="text-white/40 font-black text-sm tracking-widest">MVP</span>
                    </div>
                 </div>
              </div>

              {/* Branding */}
              <div className="absolute bottom-20 flex flex-col items-center">
                 <p className="font-black tracking-[0.8em] text-4xl text-white opacity-20">INVICTUS.APP</p>
              </div>
           </div>
        </div>

        {/* Preview Card */}
        <div className="max-w-xs w-full aspect-[9/16] bg-surface-container rounded-[40px] overflow-hidden shadow-2xl border border-outline-variant/10 relative group">
           <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-tertiary/5 opacity-50" />
           
           {/* Grid Background */}
           <div className="absolute inset-0 opacity-[0.03] text-white flex flex-wrap gap-4 font-headline italic font-black text-4xl p-4 pointer-events-none select-none">
              {Array.from({ length: 40 }).map((_, i) => <span key={i} className="transform rotate-12">{i + 1}</span>)}
           </div>

           <div className="absolute inset-0 z-20 p-8 flex flex-col justify-between items-center text-center">
              <div className="w-full flex justify-between items-start">
                 <Zap className="text-primary fill-current" size={24} />
                 <span className="bg-white/10 text-white/60 px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest">Arena status</span>
                 <Trophy className="text-prize-gold" size={20} />
              </div>

              <div className="space-y-1">
                 <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Sua Posição no Ranking</p>
                 <div className="relative inline-block">
                    <h1 className="text-8xl font-black italic tracking-tighter text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]">#{rank}</h1>
                    <Sparkles className="absolute -top-4 -right-4 text-primary animate-pulse" size={20} />
                 </div>
                 <p className="text-primary font-black text-sm uppercase tracking-widest money-glow">{rankingLabel}</p>
                 <p className="text-[8px] font-bold text-white/20 uppercase tracking-[0.3em]">{periodLabel}</p>
              </div>

              <div className="w-full bg-black/40 backdrop-blur-xl rounded-3xl p-4 border border-white/5 space-y-4">
                 <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl border border-primary/40 overflow-hidden shrink-0">
                       <img src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} className="w-full h-full object-cover" alt="" />
                    </div>
                    <div className="text-left flex-1 overflow-hidden">
                       <p className="text-[10px] font-black text-white uppercase tracking-tight truncate">{user.displayName}</p>
                       <p className="text-[8px] font-bold text-white/40 uppercase tracking-widest">INVICTUS athlete</p>
                    </div>
                    <div className="text-right">
                       <p className="text-primary font-black text-sm leading-none">{score?.toLocaleString()}</p>
                       <p className="text-[7px] font-black text-white/40">XP</p>
                    </div>
                 </div>
              </div>

              <div className="flex flex-col items-center opacity-40 grayscale">
                 <p className="font-black tracking-[0.5em] text-[10px] text-white">INVICTUS</p>
              </div>
           </div>
        </div>

        {/* Action Buttons */}
        <div className="w-full max-w-sm space-y-4">
           <button 
             onClick={handleShareSystem}
             className="w-full bg-white text-black py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl flex items-center justify-center gap-3"
           >
              <Share2 size={20} /> Compartilhar Agora
           </button>

           <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => handleExport('stories')}
                disabled={isGenerating}
                className="bg-primary text-black py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl flex items-center justify-center gap-3 disabled:opacity-50"
              >
                 {isGenerating ? <RefreshCw className="animate-spin" size={16} /> : < Instagram size={18} />} Stories
              </button>
              <button 
                onClick={() => handleExport('feed')}
                disabled={isGenerating}
                className="bg-surface-container-high text-on-surface py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] border border-outline-variant/10 flex items-center justify-center gap-3 disabled:opacity-50"
              >
                 {isGenerating ? <RefreshCw className="animate-spin" size={16} /> : <Download size={18} />} Baixar PNG
              </button>
           </div>

           <button 
             onClick={onClose}
             className="w-full text-white/40 font-black text-[10px] uppercase tracking-[0.3em] py-4"
           >
              SAIR DA ARENA
           </button>
        </div>
      </div>
    </motion.div>
  );
}

