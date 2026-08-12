
import React, { useRef, useState, useMemo } from 'react';
import { Share2, Download, Instagram, MessageCircle, X, Trophy, Flame, Zap, Camera, Image as ImageIcon, Map as MapIcon, Calendar } from 'lucide-react';
import { toPng } from 'html-to-image';
import { RunSession, AdvancedRunStats } from '../services/runningService';
import { formatDuration } from '../lib/runUtils';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useUser } from '../UserContext';

const SPECIAL_BADGES: { [key: string]: { label: string, color: string, icon: any } } = {
  '12-25': { label: 'Treino de Natal', color: 'bg-red-600', icon: '🎄' },
  '01-01': { label: 'Primeiro do Ano', color: 'bg-blue-600', icon: '🎆' },
  '05-01': { label: 'Trabalhador Fatal', color: 'bg-orange-600', icon: '👷' },
  '09-07': { label: 'Independência', color: 'bg-green-700', icon: '🇧🇷' },
};

interface RunShareCardProps {
  session: RunSession | AdvancedRunStats;
  onClose: () => void;
}

export function RunShareCard({ session, onClose }: RunShareCardProps) {
  const { user } = useUser();
  const cardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSharingLink, setIsSharingLink] = useState(false);
  const [variation, setVariation] = useState<'normal' | 'record' | 'competition'>('normal');
  const [mode, setMode] = useState<'map' | 'photo'>('map');
  const [customPhoto, setCustomPhoto] = useState<string | null>(null);

  const isFullSession = 'totalDistance' in session;
  const distanceKm = isFullSession ? (session.totalDistance / 1000).toFixed(2) : (session as AdvancedRunStats).km.toFixed(2);
  const duration = isFullSession 
    ? formatDuration(Math.floor((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000))
    : formatDuration((session as AdvancedRunStats).timeSeconds);
  const pace = isFullSession ? session.avgPace : (session as AdvancedRunStats).pace;
  const points = isFullSession ? session.points : (session as AdvancedRunStats).trajectory || [];
  const runDate = new Date(isFullSession ? session.startTime : (session as AdvancedRunStats).date);
  
  const photoUrl = customPhoto || session.photoProof;

  const holidayBadge = useMemo(() => {
    const month = String(runDate.getMonth() + 1).padStart(2, '0');
    const day = String(runDate.getDate()).padStart(2, '0');
    const key = `${month}-${day}`;
    return SPECIAL_BADGES[key] || null;
  }, [runDate]);

  const phrases = [
    "Mais um dia sem falhar",
    "Disciplina não negocia",
    "Subindo no ranking",
    "O impossível é apenas o começo",
    "Menos rotina, mais INVICTUS"
  ];
  const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCustomPhoto(event.target?.result as string);
        setMode('photo');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleShareLink = async () => {
    if (!session.id) {
      alert('Sincronizando atividade... tente novamente em instantes.');
      return;
    }

    setIsSharingLink(true);
    const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
    const shareUrl = `${baseUrl.replace(/\/$/, '')}/share/${session.id}`;
    const shareTitle = variation === 'record' ? 'NOVO RECORDE NO INVICTUS! 🏆' : 'Atividade concluída no INVICTUS! 🔥';
    const shareText = `Vem ver meu treino de ${distanceKm}km! ${randomPhrase}. #INVICTUS #Corrida`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        alert('Link copiado para a área de transferência!');
      }
    } catch (err) {
      console.error('Share Error:', err);
    } finally {
      setIsSharingLink(false);
    }
  };

  const handleExport = async (format: 'stories' | 'feed') => {
    if (!cardRef.current) return;
    setIsGenerating(true);
    
    try {
      // Small delay to ensure styles are applied
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const width = format === 'stories' ? 1080 : 1080;
      const height = format === 'stories' ? 1920 : 1080;
      
      const dataUrl = await toPng(cardRef.current, {
        canvasWidth: width,
        canvasHeight: height,
        pixelRatio: 2,
      });

      const link = document.createElement('a');
      link.download = `corrida-${distanceKm}km-${format}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export Error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-xl flex flex-col p-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-black text-white italic tracking-tighter uppercase">COMPARTILHAR CONQUISTA</h2>
        <button onClick={onClose} className="p-2 text-white/60 hover:text-white"><X size={24} /></button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-8 flex flex-col items-center">
        {/* Hidden Exportable Card */}
        <div className="hidden">
           <div 
             ref={cardRef} 
             className="relative bg-black flex flex-col items-center justify-center overflow-hidden"
             style={{ 
               width: '1080px', 
               height: variation === 'normal' ? '1080px' : '1920px',
               background: photoUrl && mode === 'photo' ? 'none' : 'linear-gradient(135deg, #000 0%, #111 100%)' 
             }}
           >
              {/* Photo Background */}
              {photoUrl && mode === 'photo' && (
                <>
                  <img src={photoUrl} className="absolute inset-0 w-full h-full object-cover" alt="" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-black/60" />
                </>
              )}

              {/* Background Decoration (Hidden in Photo Mode) */}
              {mode === 'map' && (
                <div className="absolute inset-0 opacity-20">
                  <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/20 blur-[150px] rounded-full" />
                  <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-secondary/10 blur-[120px] rounded-full" />
                </div>
              )}

              {/* Trajectory Background */}
              {points && points.length > 2 && (
                <div className="absolute inset-40 opacity-10 flex items-center justify-center pointer-events-none">
                  <svg viewBox="0 0 100 100" className="w-full h-full transform scale-150">
                    {(() => {
                      const lats = points.map(p => p.lat);
                      const lngs = points.map(p => p.lng);
                      const minLat = Math.min(...lats);
                      const maxLat = Math.max(...lats);
                      const minLng = Math.min(...lngs);
                      const maxLng = Math.max(...lngs);
                      
                      const rangeLat = Math.max(0.0001, maxLat - minLat);
                      const rangeLng = Math.max(0.0001, maxLng - minLng);

                      const scaleX = (x: number) => ((x - minLng) / rangeLng) * 100;
                      const scaleY = (y: number) => 100 - ((y - minLat) / rangeLat) * 100;

                      const path = points.map((p, i) => 
                        `${i === 0 ? 'M' : 'L'} ${scaleX(p.lng)} ${scaleY(p.lat)}`
                      ).join(' ');

                      return <path d={path} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
                    })()}
                  </svg>
                </div>
              )}

              {/* Main Content */}
              <div className="relative z-10 w-full px-20 flex flex-col items-center text-center">
                 {/* Holiday Badge */}
                 {holidayBadge && (
                    <div className="absolute top-0 left-0">
                       <div className={cn("px-10 py-4 rounded-br-[40px] flex items-center gap-4", holidayBadge.color)}>
                          <span className="text-5xl">{holidayBadge.icon}</span>
                          <span className="text-white font-black text-2xl uppercase tracking-widest">{holidayBadge.label}</span>
                       </div>
                    </div>
                 )}

                 <div className="mb-12">
                     <span className="bg-primary text-black px-8 py-2 rounded-full font-black text-2xl uppercase tracking-[0.3em]">
                       {variation === 'record' ? 'NOVO RECORDE' : 'CORRIDA CONCLUÍDA'}
                     </span>
                 </div>

                 <h1 className="text-[180px] font-black italic tracking-tighter leading-none text-white mb-4">
                   {distanceKm}<span className="text-4xl italic ml-2">KM</span>
                 </h1>

                 <div className="grid grid-cols-2 gap-20 w-full mt-10">
                    <div className="text-center">
                       <p className="text-white/40 font-black text-2xl uppercase tracking-widest mb-2">RITMO MÉDIO</p>
                       <p className="text-white font-black text-6xl">{pace}<span className="text-xl ml-1 text-white/60">/km</span></p>
                    </div>
                    <div className="text-center">
                       <p className="text-white/40 font-black text-2xl uppercase tracking-widest mb-2">TEMPO TOTAL</p>
                       <p className="text-white font-black text-6xl">{duration}</p>
                    </div>
                 </div>

                 <div className="mt-40 border-t border-white/10 pt-16 w-full">
                    <p className="text-primary font-bold italic text-3xl mb-4 italic">"{randomPhrase}"</p>
                    <div className="flex items-center justify-center gap-4">
                       <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-black font-black text-2xl">
                          {user?.displayName?.[0] || 'U'}
                       </div>
                       <div className="text-left">
                          <p className="text-white font-black text-3xl uppercase tracking-tight">{user?.displayName || 'USUÁRIO'}</p>
                          <p className="text-white/40 text-xl font-bold uppercase tracking-[0.2em]">INVICTUS team</p>
                       </div>
                    </div>
                 </div>
              </div>

              {/* Branding */}
              <div className="absolute bottom-20 flex flex-col items-center opacity-30">
                 <Zap className="text-primary fill-current mb-2" size={48} />
                 <p className="font-black tracking-[0.5em] text-2xl text-white">INVICTUS</p>
              </div>
           </div>
        </div>

        {/* Live Preview Card */}
        <div className="max-w-xs w-full aspect-[9/16] bg-surface-container rounded-[40px] overflow-hidden shadow-2xl border border-outline-variant/10 relative group">
            {/* Background Image / Overlay */}
            {photoUrl && mode === 'photo' ? (
               <>
                 <img src={photoUrl} className="absolute inset-0 w-full h-full object-cover" alt="" />
                 <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40 z-10" />
               </>
            ) : (
               <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/20 to-black/80 z-10" />
            )}
            
            {/* Background "Map" Placeholder (Hidden in photo mode) */}
            <div className={cn(
              "absolute inset-0 bg-surface-container-highest flex items-center justify-center overflow-hidden transition-opacity",
              mode === 'photo' ? 'opacity-0' : 'opacity-100'
            )}>
               {points && points.length > 2 ? (
                  <div className="w-full h-full p-12 opacity-10 flex items-center justify-center">
                    <svg viewBox="0 0 100 100" className="w-full h-full transform scale-150">
                      {(() => {
                        const lats = points.map(p => p.lat);
                        const lngs = points.map(p => p.lng);
                        const minLat = Math.min(...lats);
                        const maxLat = Math.max(...lats);
                        const minLng = Math.min(...lngs);
                        const maxLng = Math.max(...lngs);
                        
                        const rangeLat = Math.max(0.0001, maxLat - minLat);
                        const rangeLng = Math.max(0.0001, maxLng - minLng);

                        const scaleX = (x: number) => ((x - minLng) / rangeLng) * 100;
                        const scaleY = (y: number) => 100 - ((y - minLat) / rangeLat) * 100;

                        const path = points.map((p, i) => 
                          `${i === 0 ? 'M' : 'L'} ${scaleX(p.lng)} ${scaleY(p.lat)}`
                        ).join(' ');

                        return <path d={path} fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />;
                      })()}
                    </svg>
                  </div>
               ) : (
                  <div className="opacity-5">
                    <Zap size={200} />
                  </div>
               )}
            </div>

            <div className="absolute inset-0 z-20 p-8 flex flex-col justify-between">
               <div className="flex justify-between items-start">
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest",
                    variation === 'record' ? "bg-primary text-black" : "bg-white/10 text-white"
                  )}>
                    {variation === 'record' ? 'Novo Recorde' : 'Concluída'}
                  </span>
                  
                  {holidayBadge && (
                    <div className={cn("px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest flex items-center gap-1", holidayBadge.color)}>
                       <span>{holidayBadge.icon}</span>
                       <span className="text-white">{holidayBadge.label}</span>
                    </div>
                  )}
                  
                  <Zap className="text-primary fill-current" size={24} />
               </div>

               <div className="text-center">
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] mb-1">DISTÂNCIA</p>
                  <h3 className="text-6xl font-black italic tracking-tighter text-white">{distanceKm}<span className="text-xs ml-1">KM</span></h3>
               </div>

               <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                        <p className="text-[8px] font-black text-white/40 uppercase tracking-widest">PACE</p>
                        <p className="text-lg font-black text-white">{pace}<span className="text-[10px] ml-1 text-white/40">/km</span></p>
                     </div>
                     <div>
                        <p className="text-[8px] font-black text-white/40 uppercase tracking-widest">TEMPO</p>
                        <p className="text-lg font-black text-white">{duration}</p>
                     </div>
                  </div>

                  <div className="flex items-center gap-3 border-t border-white/10 pt-4">
                     <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-black text-[10px]">
                        {user?.displayName?.[0] || 'U'}
                     </div>
                     <div>
                        <p className="text-[10px] font-black text-white uppercase tracking-tight">{user?.displayName || 'Atleta Fatal'}</p>
                        <p className="text-[8px] text-white/40 font-bold uppercase tracking-widest italic leading-none">"{randomPhrase}"</p>
                     </div>
                  </div>
               </div>
            </div>
        </div>

        {/* Action Buttons */}
        <div className="w-full space-y-4">
           {/* Mode Toggles */}
           <div className="flex bg-surface-container rounded-2xl p-1 border border-outline-variant/10">
              <button 
                onClick={() => setMode('map')}
                className={cn(
                  "flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  mode === 'map' ? "bg-primary text-black" : "text-white/40 hover:text-white"
                )}
              >
                <MapIcon size={14} /> Mapa
              </button>
              <button 
                onClick={() => {
                  if (photoUrl) setMode('photo');
                  else fileInputRef.current?.click();
                }}
                className={cn(
                  "flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  mode === 'photo' ? "bg-primary text-black" : "text-white/40 hover:text-white"
                )}
              >
                {photoUrl ? <><ImageIcon size={14} /> Foto</> : <><Camera size={14} /> Sobe Foto</>}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
           </div>

           <div className="grid grid-cols-3 gap-3">
              <VariationButton active={variation === 'normal'} onClick={() => setVariation('normal')} label="Normal" />
              <VariationButton active={variation === 'record'} onClick={() => setVariation('record')} label="Recorde" />
              <VariationButton active={variation === 'competition'} onClick={() => setVariation('competition')} label="Ranking" />
           </div>

           <div className="space-y-3 pt-4">
              <button 
                onClick={handleShareLink}
                disabled={isSharingLink}
                className="w-full bg-white text-black py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isSharingLink ? <RefreshCw className="animate-spin" /> : <><Share2 size={18} /> Compartilhar Link (WhatsApp/IG)</>}
              </button>

              <button 
                onClick={() => handleExport('stories')}
                disabled={isGenerating}
                className="w-full bg-primary text-black py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isGenerating ? <RefreshCw className="animate-spin" /> : <><Instagram size={18} /> Instagram Stories</>}
              </button>
              
              <button 
                onClick={() => handleExport('feed')}
                disabled={isGenerating}
                className="w-full bg-surface-container-high text-on-surface py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] border border-outline-variant/10 flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isGenerating ? <RefreshCw className="animate-spin" /> : <><Download size={18} /> Baixar Feed (1:1)</>}
              </button>

              <button 
                onClick={() => onClose()}
                className="w-full text-white/40 font-black text-[10px] uppercase tracking-[0.3em] py-4"
              >
                NÃO COMPARTILHAR
              </button>
           </div>
        </div>
      </div>
    </div>
  );
}

function VariationButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "py-3 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all",
        active 
          ? "bg-primary/20 border-primary text-primary" 
          : "bg-surface-container-high border-outline-variant/10 text-on-surface-variant"
      )}
    >
      {label}
    </button>
  );
}

function RefreshCw(props: any) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      {...props}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
