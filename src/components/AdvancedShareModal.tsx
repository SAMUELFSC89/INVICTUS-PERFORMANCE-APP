import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Camera, Map as MapIcon, Share2, Download, 
  Flame, Timer, Ruler, TrendingUp, Hash, Calendar, 
  Check, Phone, Instagram, Send, Info, EyeOff, Eye,
  Zap, Trophy
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { AdvancedRunStats, RunTrajectory } from '../services/runningService';
import { useUser } from '../UserContext';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface AdvancedShareModalProps {
  stats: AdvancedRunStats & { rank?: number | string };
  onClose: () => void;
}

export function AdvancedShareModal({ stats, onClose }: AdvancedShareModalProps) {
  const { user } = useUser();
  const cardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [userPhoto, setUserPhoto] = useState<string | null>(user?.photoURL || null);
  const [backgroundType, setBackgroundType] = useState<'photo' | 'map' | 'solid'>('photo');
  const [accentColor, setAccentColor] = useState('#22c55e'); // Green neon
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Customization Toggles
  const [config, setConfig] = useState({
    showMap: true,
    showCalories: true,
    showPace: true,
    showRank: true,
    showTime: true,
    showElevation: true,
    showSteps: true,
    showDate: true,
  });

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setUserPhoto(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setIsGenerating(true);
    try {
      // Ensure fonts and images are loaded
      await new Promise(resolve => setTimeout(resolve, 500));
      const dataUrl = await toPng(cardRef.current, { cacheBust: true, quality: 1 });
      const link = document.createElement('a');
      link.download = `corrida-INVICTUS-${format(new Date(), 'yyyy-MM-dd')}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to generate image', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleShare = async (platform: 'whatsapp' | 'instagram' | 'other') => {
    if (!cardRef.current) return;
    setIsGenerating(true);
    try {
      const dataUrl = await toPng(cardRef.current, { cacheBust: true, quality: 1 });
      
      if (platform === 'whatsapp') {
        window.open(`https://api.whatsapp.com/send?text=Confira minha corrida no KM Fatal!`);
      } else if (platform === 'instagram') {
        // Typically requires mobile native share or user manual upload
        // For web demo, we just download and suggest upload
        await handleDownload();
        alert('Imagem baixada! Agora você pode postar nos seus Stories.');
      } else {
        // Universal share API if supported
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const file = new File([blob], 'corrida.png', { type: 'image/png' });
        
        if (navigator.share) {
          await navigator.share({
            files: [file],
            title: 'Minha Corrida - INVICTUS',
            text: 'Desafio KM Fatal!',
          });
        } else {
          await handleDownload();
        }
      }
    } catch (err) {
      console.error('Error sharing', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md overflow-y-auto p-4 md:p-8">
      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        
        {/* Preview Area */}
        <div className="relative sticky top-0 flex items-center justify-center">
          {/* THE CARD COMPONENT */}
          <div 
            ref={cardRef}
            id="share-card-advanced"
            className="w-[400px] h-[711px] bg-black overflow-hidden relative shadow-2xl flex flex-col font-sans"
            style={{ minWidth: '400px', minHeight: '711px' }}
          >
            {/* Background Layer */}
            <div className="absolute inset-0">
               {backgroundType === 'photo' && userPhoto && (
                 <img 
                   src={userPhoto} 
                   alt="" 
                   className="w-full h-full object-cover" 
                   referrerPolicy="no-referrer"
                 />
               )}
               {/* Overlay effect */}
               <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
            </div>

            {/* Content Layer */}
            <div className="relative z-10 p-6 flex flex-col h-full text-white font-body">
              
              {/* Top Branding */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex flex-col">
                  <h1 className="text-primary font-headline italic font-black text-3xl tracking-tighter leading-none" style={{ color: accentColor }}>KM FATAL</h1>
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Desafio de Corrida</span>
                </div>
                <div className="flex flex-col items-end">
                  <p className="text-[10px] font-black uppercase text-white tracking-widest italic">INVICTUS ⚡</p>
                </div>
              </div>

              {/* Main Stat */}
              <div className="mt-8 mb-6">
                <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Eu Corri</span>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-7xl font-headline font-black italic tracking-tighter leading-none" style={{ color: accentColor }}>{stats.km.toFixed(2)}</h2>
                  <span className="text-2xl font-headline font-black italic tracking-tighter uppercase" style={{ color: accentColor }}>KM</span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-2 mb-8">
                 {config.showTime && (
                   <div className="bg-black/40 backdrop-blur-md p-3 rounded-2xl border border-white/10">
                     <Timer size={14} className="mb-1" style={{ color: accentColor }} />
                     <p className="text-[9px] font-black uppercase tracking-widest opacity-60">Tempo</p>
                     <p className="text-sm font-black">{Math.floor(stats.timeSeconds / 60)}:{String(stats.timeSeconds % 60).padStart(2, '0')}</p>
                   </div>
                 )}
                 {config.showPace && (
                   <div className="bg-black/40 backdrop-blur-md p-3 rounded-2xl border border-white/10">
                     <Zap size={14} className="mb-1" style={{ color: accentColor }} />
                     <p className="text-[9px] font-black uppercase tracking-widest opacity-60">Ritmo Médio</p>
                     <p className="text-sm font-black">{stats.pace}</p>
                   </div>
                 )}
                 {config.showCalories && (
                   <div className="bg-black/40 backdrop-blur-md p-3 rounded-2xl border border-white/10">
                     <Flame size={14} className="mb-1" style={{ color: accentColor }} />
                     <p className="text-[9px] font-black uppercase tracking-widest opacity-60">Kcal</p>
                     <p className="text-sm font-black">{stats.calories}</p>
                   </div>
                 )}
              </div>

              {/* Map/Trajectory Section */}
              {config.showMap && stats.trajectory && stats.trajectory.length > 0 && (
                <div className="flex-1 min-h-[160px] relative mt-4">
                  <div className="absolute inset-0 bg-black/20 rounded-3xl border border-white/5 overflow-hidden">
                     {/* Trajectory Drawing */}
                     <svg className="w-full h-full preserve-3d" viewBox="0 0 100 100">
                        <TrajectoryPath points={stats.trajectory} color={accentColor} />
                     </svg>
                  </div>
                  <div className="absolute top-4 left-4 p-2 bg-black/60 rounded-xl">
                      <p className="text-[8px] font-black uppercase tracking-widest opacity-60">Trajetória</p>
                  </div>
                  {/* Detailed mini stats next to map */}
                  <div className="absolute right-4 top-4 text-right space-y-2">
                     {config.showElevation && (
                       <div>
                         <p className="text-[8px] font-black uppercase tracking-widest opacity-60">Ganho Elev.</p>
                         <p className="text-xs font-black">{stats.elevationGain}m</p>
                       </div>
                     )}
                     {config.showSteps && (
                       <div>
                         <p className="text-[8px] font-black uppercase tracking-widest opacity-60">Passos</p>
                         <p className="text-xs font-black">{stats.steps.toLocaleString()}</p>
                       </div>
                     )}
                  </div>
                </div>
              )}

              {/* Ranking & Call to action */}
              <div className="mt-8 flex items-end justify-between">
                <div className="flex items-center gap-4">
                  {config.showRank && (
                    <div className="flex items-center gap-3">
                       <div className="flex flex-col">
                         <span className="text-[8px] font-black uppercase tracking-widest opacity-60">Sua Posição</span>
                         <span className="text-2xl font-black italic leading-none" style={{ color: accentColor }}>#{stats.rank || '--'}</span>
                       </div>
                       <div className="w-12 h-12 rounded-full border-2 border-primary/40 flex items-center justify-center" style={{ borderColor: `${accentColor}40`, color: accentColor }}>
                          <span className="text-lg font-black">{stats.rank || '?'}</span>
                       </div>
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-primary uppercase leading-tight" style={{ color: accentColor }}>Campanha com</span>
                    <span className="text-[10px] font-black text-white uppercase leading-tight">Incentivos!</span>
                  </div>
                </div>
              </div>

              {/* Bottom Info */}
              <div className="mt-auto pt-6 flex items-center justify-between border-t border-white/10">
                <div className="flex flex-col">
                  {config.showDate && (
                    <p className="text-[8px] font-bold uppercase opacity-60 flex items-center gap-1">
                       <Calendar size={10} /> 
                       {format(new Date(stats.date), "dd 'de' MMMM 'de' yyyy • HH:mm", { locale: ptBR })}
                    </p>
                  )}
                  <p className="text-[10px] font-black text-primary uppercase mt-1" style={{ color: accentColor }}>#INVICTUS</p>
                </div>
                <div className="flex items-center gap-3">
                   <div className="flex flex-col items-end">
                      <p className="text-[8px] font-bold uppercase opacity-40">Disponível na</p>
                      <p className="text-[10px] font-black">APP STORE / GOOGLE PLAY</p>
                   </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Customization Panel */}
        <div className="bg-surface-container rounded-[40px] p-8 space-y-8 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-black text-white italic uppercase italic tracking-tighter">Personalize seu Card</h3>
              <p className="text-on-surface-variant text-xs font-bold uppercase tracking-widest opacity-60 italic">Crie o visual perfeito para compartilhar</p>
            </div>
            <button onClick={onClose} className="p-3 bg-white/5 rounded-full hover:bg-white/10 transition-colors">
              <X size={24} className="text-white" />
            </button>
          </div>

          <div className="space-y-6">
            {/* Photo Selection */}
            <div className="space-y-4">
               <label className="text-xs font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                 <Camera size={14} /> Sua Foto
               </label>
               <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 border border-dashed border-white/20 flex items-center justify-center overflow-hidden">
                     {userPhoto ? <img src={userPhoto} alt="" className="w-full h-full object-cover" /> : <Camera className="opacity-20" />}
                  </div>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-white/10 px-4 py-3 rounded-xl text-[10px] font-black uppercase border border-white/5 hover:bg-white/20 transition-all"
                  >
                    Trocar Foto
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
               </div>
            </div>

            {/* Background Style */}
            <div className="space-y-4">
               <label className="text-xs font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                 <MapIcon size={14} /> Escolha o fundo
               </label>
               <div className="grid grid-cols-3 gap-3">
                  <BackgroundOption label="Foto" active={backgroundType === 'photo'} onClick={() => setBackgroundType('photo')} />
                  <BackgroundOption label="Mapa" active={backgroundType === 'map'} onClick={() => setBackgroundType('map')} />
                  <BackgroundOption label="Sólido" active={backgroundType === 'solid'} onClick={() => setBackgroundType('solid')} />
               </div>
            </div>

            {/* Color Accent */}
            <div className="space-y-4">
               <label className="text-xs font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                 🎨 Cor do Card
               </label>
               <div className="flex gap-3">
                  {['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7'].map(color => (
                    <button 
                      key={color} 
                      onClick={() => setAccentColor(color)}
                      className={cn(
                        "w-8 h-8 rounded-full border-2 transition-all",
                        accentColor === color ? "border-white scale-110" : "border-transparent opacity-60"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
               </div>
            </div>

            {/* Toggles */}
            <div className="space-y-4">
               <label className="text-xs font-black uppercase tracking-[0.2em] text-primary">Mostrar no card</label>
               <div className="grid grid-cols-2 gap-4">
                  {Object.entries(config).map(([key, value]) => (
                    <button 
                      key={key} 
                      onClick={() => setConfig(prev => ({ ...prev, [key]: !value }))}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-2xl border transition-all text-left",
                        value ? "bg-primary/10 border-primary/40 text-white" : "bg-white/5 border-white/5 text-on-surface-variant opacity-60"
                      )}
                    >
                      <div className={cn("w-5 h-5 rounded-md flex items-center justify-center border", value ? "bg-primary border-primary" : "border-outline")}>
                        {value && <Check size={12} className="text-black" />}
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-tight">{formatKeyName(key)}</span>
                    </button>
                  ))}
               </div>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 space-y-6">
             <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant opacity-80">Compartilhe em</p>
             </div>
             <div className="flex items-center gap-4">
                <ShareButton icon={<Phone className="text-green-500 fill-current" />} label="WhatsApp" onClick={() => handleShare('whatsapp')} />
                <ShareButton icon={<Instagram className="text-pink-500" />} label="Stories" onClick={() => handleShare('instagram')} />
                <ShareButton icon={<Send className="text-blue-500 fill-current" />} label="Outros" onClick={() => handleShare('other')} />
                <ShareButton icon={<Download className="text-white" />} label="Baixar" onClick={handleDownload} />
             </div>
          </div>

          <div className="p-4 bg-primary/5 rounded-3xl border border-primary/20">
             <div className="flex gap-3">
                <Trophy className="text-primary shrink-0" size={24} />
                <div className="space-y-1">
                   <h4 className="text-sm font-black text-white italic tracking-tight uppercase">Corrida Incrível!</h4>
                   <p className="text-[10px] font-medium text-on-surface-variant opacity-80">Seu desempenho te coloca no Top 10 oficial. Quer participar dos incentivos este mês?</p>
                </div>
             </div>
             <button
               type="button"
               onClick={() => { onClose(); window.location.assign('/challenges'); }}
               className="w-full mt-4 bg-primary text-black py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 transition-all"
             >
                QUERO PARTICIPAR!
             </button>
          </div>
        </div>
      </div>

      {/* Generation Loader Overlay */}
      {isGenerating && (
        <div className="fixed inset-0 z-[300] bg-black/60 flex flex-center items-center justify-center p-6">
           <div className="bg-surface-container p-8 rounded-3xl flex flex-col items-center gap-4">
              <Zap className="animate-spin text-primary" size={48} />
              <p className="text-xs font-black uppercase tracking-widest">Gerando seu Card Elite...</p>
           </div>
        </div>
      )}
    </div>
  );
}

function TrajectoryPath({ points, color }: { points: RunTrajectory[]; color: string }) {
  if (points.length < 2) return null;

  // Normalize points to 0-100 viewBox
  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const padding = 10;
  const scaleX = (100 - 2 * padding) / (maxLng - minLng || 1);
  const scaleY = (100 - 2 * padding) / (maxLat - minLat || 1);

  const getX = (lng: number) => padding + (lng - minLng) * scaleX;
  const getY = (lat: number) => 100 - (padding + (lat - minLat) * scaleY); // Flip Y because SVG y starts at top

  const pathData = points.reduce((acc, p, i) => {
    const x = getX(p.lng);
    const y = getY(p.lat);
    return i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
  }, '');

  return (
    <g>
      {/* Background path for outline effect */}
      <path 
        d={pathData} 
        fill="none" 
        stroke="black" 
        strokeWidth="6" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className="opacity-20"
      />
      {/* Main path */}
      <path 
        d={pathData} 
        fill="none" 
        stroke={color} 
        strokeWidth="4" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className="drop-shadow-lg"
      />
      {/* Start Point */}
      <circle cx={getX(points[0].lng)} cy={getY(points[0].lat)} r="4" fill="white" stroke={color} strokeWidth="2" />
      {/* End Point */}
      <circle cx={getX(points[points.length-1].lng)} cy={getY(points[points.length-1].lat)} r="4" fill={color} stroke="white" strokeWidth="2" />
    </g>
  );
}

function BackgroundOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all",
        active ? "bg-primary text-black border-primary" : "bg-white/5 border-white/10 text-on-surface-variant hover:bg-white/10"
      )}
    >
      {label}
    </button>
  );
}

function ShareButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2 group">
      <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center transition-all group-hover:scale-110 group-hover:bg-white/10 active:scale-95 group-hover:border-primary/40">
        {icon}
      </div>
      <span className="text-[10px] font-bold text-on-surface-variant uppercase opacity-60 group-hover:opacity-100 transition-opacity">{label}</span>
    </button>
  );
}

function formatKeyName(key: string) {
  const names: Record<string, string> = {
    showMap: 'Mapa',
    showCalories: 'Calorias',
    showPace: 'Ritmo Médio',
    showRank: 'Posição',
    showTime: 'Tempo',
    showElevation: 'Elevação',
    showSteps: 'Passos',
    showDate: 'Data',
  };
  return names[key] || key;
}
