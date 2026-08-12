
import React, { useRef, useState } from 'react';
import { Share2, Download, Instagram, X, Trophy, Zap, Heart, MapPin, Star, RefreshCw } from 'lucide-react';
import { toPng } from 'html-to-image';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { UserProfile } from '../types';
import { getLevelFromXP } from '../lib/levelUtils';

interface ProfileShareCardProps {
  user: UserProfile;
  onClose: () => void;
}

export function ProfileShareCard({ user, onClose }: ProfileShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
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
      link.download = `moove-profile-${user.displayName.replace(/\s+/g, '-')}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export Error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const userXP = user.xp || 0;
  const userLevel = getLevelFromXP(userXP);

  const handleShareSystem = async () => {
    const text = `Vem ver meu progresso no INVICTUS! Sou Level ${userLevel} com ${userXP.toLocaleString()} XP! 🔥 #INVICTUS #fitness #workout`;
    const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
    const url = baseUrl.replace(/\/$/, '');
    
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Meu Perfil no INVICTUS', text, url });
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

              {/* Trajectory Pattern */}
              <div className="absolute inset-0 opacity-[0.05] pointer-events-none p-20 flex flex-wrap gap-20">
                {Array.from({ length: 48 }).map((_, i) => (
                  <Zap key={i} size={80} className="text-white transform rotate-12" />
                ))}
              </div>

              <div className="relative z-10 w-full px-20 flex flex-col items-center">
                 {/* Profile Avatar */}
                 <div className="relative mb-16">
                    <div className="absolute -inset-4 bg-primary/30 blur-2xl rounded-full" />
                    <div className="w-64 h-64 rounded-[60px] border-8 border-white/20 overflow-hidden shadow-2xl relative z-10">
                       <img src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} className="w-full h-full object-cover" alt="" />
                    </div>
                    <div className="absolute -bottom-6 -right-6 bg-primary text-black px-8 py-3 rounded-2xl font-black text-4xl shadow-2xl z-20 border-4 border-black/10">
                       LVL {userLevel}
                    </div>
                 </div>

                 <h1 className="text-white font-black text-8xl uppercase tracking-tight mb-4">{user.displayName}</h1>
                 <p className="text-primary font-black text-4xl uppercase tracking-[0.5em] mb-32">ATLETA ELITE INVICTUS</p>

                 {/* Stats Grid */}
                 <div className="grid grid-cols-2 gap-12 w-full mb-32">
                    <div className="bg-white/5 border border-white/10 rounded-[50px] p-16 text-center space-y-4 backdrop-blur-3xl">
                       <p className="text-white/40 font-black text-3xl uppercase tracking-widest">EXPERIÊNCIA XP</p>
                       <p className="text-white font-black text-8xl leading-none text-glow-primary">{userXP.toLocaleString()}</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-[50px] p-16 text-center space-y-4 backdrop-blur-3xl">
                       <p className="text-white/40 font-black text-3xl uppercase tracking-widest">SEQUÊNCIA</p>
                       <p className="text-white font-black text-8xl leading-none">{user.streak} DIAS</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-[50px] p-16 text-center space-y-4 backdrop-blur-3xl">
                       <p className="text-white/40 font-black text-3xl uppercase tracking-widest">RANK NACIONAL</p>
                       <p className="text-primary font-black text-8xl leading-none italic">#{user.positions.national || '-'}</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-[50px] p-16 text-center space-y-4 backdrop-blur-3xl">
                       <p className="text-white/40 font-black text-3xl uppercase tracking-widest">RANK CIDADE</p>
                       <p className="text-tertiary font-black text-8xl leading-none italic">#{user.positions.city || '-'}</p>
                    </div>
                 </div>

                 {/* User Info Tags */}
                 <div className="flex flex-wrap justify-center gap-6 mb-32">
                    <div className="bg-white/10 px-8 py-4 rounded-full flex items-center gap-4 border border-white/20">
                       <MapPin className="text-primary" size={32} />
                       <span className="text-white font-black text-2xl uppercase">{user.city || 'BRASIL'}</span>
                    </div>
                    <div className="bg-white/10 px-8 py-4 rounded-full flex items-center gap-4 border border-white/20">
                       <Heart className="text-red-500" size={32} fill="currentColor" />
                       <span className="text-white font-black text-2xl uppercase">PRO ACTIVE</span>
                    </div>
                    <div className="bg-white/10 px-8 py-4 rounded-full flex items-center gap-4 border border-white/20">
                       <Trophy className="text-prize-gold" size={32} />
                       <span className="text-white font-black text-2xl uppercase">LEADERSHIP CLUSTER</span>
                    </div>
                 </div>

                 {/* Invite Code */}
                 <div className="bg-primary/20 border border-primary/40 rounded-[40px] px-20 py-8 mb-20">
                    <p className="text-white/60 font-black text-2xl uppercase tracking-widest text-center mb-2">USE MEU CÓDIGO</p>
                    <p className="text-primary font-black text-6xl uppercase tracking-[0.4em] text-center">{user.referralCode}</p>
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
                 <span className="bg-white/10 text-white/60 px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest">Player card</span>
                 <Star className="text-tertiary" size={20} fill="currentColor" />
              </div>

              <div className="space-y-6">
                 <div className="relative inline-block">
                    <div className="absolute -inset-4 bg-primary/20 blur-xl rounded-full" />
                    <div className="w-24 h-24 rounded-[32px] border-4 border-white/10 overflow-hidden relative z-10 shadow-xl">
                       <img src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} className="w-full h-full object-cover" alt="" />
                    </div>
                    <div className="absolute -bottom-2 -right-2 bg-primary text-black px-2 py-0.5 rounded-lg text-[10px] font-black shadow-xl z-20">
                       LVL {userLevel}
                    </div>
                 </div>
                 <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tight mb-1">{user.displayName}</h2>
                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] opacity-80 leading-none group-hover:scale-110 transition-transform">INVICTUS Athlete</p>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-3 w-full">
                 <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                    <p className="text-[7px] font-black text-white/40 uppercase mb-1">XP ACUMULADO</p>
                    <p className="text-lg font-black text-white leading-none">{userXP.toLocaleString()}</p>
                 </div>
                 <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                    <p className="text-[7px] font-black text-white/40 uppercase mb-1">STREAK</p>
                    <p className="text-lg font-black text-white leading-none">{user.streak}d</p>
                 </div>
                 <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                    <p className="text-[7px] font-black text-white/40 uppercase mb-1">RANK BR</p>
                    <p className="text-lg font-black text-primary leading-none italic">#{user.positions.national || '-'}</p>
                 </div>
                 <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                    <p className="text-[7px] font-black text-white/40 uppercase mb-1">RANK CITY</p>
                    <p className="text-lg font-black text-tertiary leading-none italic">#{user.positions.city || '-'}</p>
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
             onClick={handleShareSystem}
             className="w-full bg-white text-black py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl flex items-center justify-center gap-3"
           >
              <Share2 size={20} /> Compartilhar Perfil
           </button>

           <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => handleExport('stories')}
                disabled={isGenerating}
                className="bg-primary text-black py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl flex items-center justify-center gap-3 disabled:opacity-50"
              >
                 {isGenerating ? <RefreshCw className="animate-spin" size={16} /> : <Instagram size={18} />} IG Stories
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
              VOLTAR AO APP
           </button>
        </div>
      </div>
    </motion.div>
  );
}
