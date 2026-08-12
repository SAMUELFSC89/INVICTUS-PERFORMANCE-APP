import React, { useState } from 'react';
import { Dumbbell, MapPin, Trophy, Search, Settings, ArrowLeft, Plus, Info, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../UserContext';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { GymSelector } from '../components/GymSelector';
import { GymRanking } from '../components/GymRanking';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { ActivityInfoPopup } from '../components/ActivityInfoPopup';

export function Gym() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [isChangingGym, setIsChangingGym] = useState(false);
  const [gymData, setGymData] = useState<any>(null);
  const [showInfo, setShowInfo] = useState(false);

  React.useEffect(() => {
    if (user && !user.seenTreinoInfo) {
      setShowInfo(true);
    }
  }, [user]);

  React.useEffect(() => {
    let active = true;
    const loadGymData = async () => {
      if (user?.gymId) {
        try {
          console.log(`[GymPage] Loading gym data for: ${user.gymId}`);
          const gymRef = doc(db, 'gyms', user.gymId);
          // Try to get from server first to be sure, or cache fallback
          const snap = await getDoc(gymRef);
          
          if (snap.exists() && active) {
            setGymData(snap.data());
          } else if (active) {
            console.warn(`[GymPage] Gym ${user.gymId} not found in database`);
          }
        } catch (error: any) {
          console.error('Error loading gym details:', error);
          if (error.message?.includes('offline')) {
            console.error('Firestore thinks we are offline. This might be a temporary network issue or a sandbox restriction.');
          }
        }
      } else if (active) {
        setGymData(null);
      }
    };
    loadGymData();
    return () => { active = false; };
  }, [user?.gymId]);

  if (!user) return null;

  const gymPhotoUrl = gymData?.photo_url 
    ? (gymData.photo_url.startsWith('http') || gymData.photo_url.startsWith('/api')
        ? gymData.photo_url 
        : `/api/gyms/photo?ref=${gymData.photo_url}`)
    : "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=1000&auto=format&fit=crop";

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <header className="relative h-64 overflow-hidden bg-surface-container-high">
        <img 
          src={gymPhotoUrl}
          alt="Gym Background" 
          className="w-full h-full object-cover brightness-75 transition-opacity duration-500"
          referrerPolicy="no-referrer"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=1000&auto=format&fit=crop";
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background"></div>
        
        {/* Back and Settings */}
        <div className="absolute top-12 left-6 right-6 flex justify-between items-center z-20">
          <button 
            onClick={() => navigate(-1)}
            className="w-12 h-12 bg-black/50 backdrop-blur-md rounded-2xl flex items-center justify-center text-white border border-white/10 shadow-lg active:scale-90 transition-transform"
          >
            <ArrowLeft size={24} />
          </button>
          <button 
            onClick={() => setIsChangingGym(!isChangingGym)}
            className={cn(
              "px-4 h-12 rounded-2xl flex items-center gap-2 font-label text-[10px] font-black uppercase tracking-widest transition-all backdrop-blur-md shadow-lg border active:scale-95",
              isChangingGym 
                ? "bg-alert-red text-white border-alert-red/50" 
                : "bg-black/50 text-white border-white/10"
            )}
          >
            {isChangingGym ? <X size={18} /> : <Settings size={18} />}
            {isChangingGym ? 'CANCELAR' : 'TROCAR UNIDADE'}
          </button>
        </div>

        <div className="absolute bottom-6 left-6 right-6">
          <div className="flex items-center gap-2 mb-1">
            <Dumbbell size={14} className="text-primary sm:w-4 sm:h-4" />
            <span className="font-label text-[8px] sm:text-[10px] font-black text-primary uppercase tracking-[0.2em]">SUA UNIDADE ATUAL</span>
          </div>
          <h1 className="font-headline italic font-black text-3xl sm:text-4xl text-on-surface uppercase tracking-tighter leading-none truncate pr-4">
            {user.gymName || 'SEM ACADEMIA'}
          </h1>
          {user.gymName && (
            <div className="flex items-center gap-2 mt-2 text-on-surface-variant">
              <MapPin size={10} className="sm:w-3 sm:h-3" />
              <span className="font-label text-[8px] sm:text-[10px] font-bold uppercase tracking-widest">Unidade Vinculada</span>
            </div>
          )}
        </div>
      </header>

      <main className="px-6 -mt-4 relative z-10 space-y-8">
        <AnimatePresence mode="wait">
          {!user.gymId || isChangingGym ? (
            <motion.div
              key="selector"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-surface-container-low p-8 rounded-[40px] shadow-2xl border border-outline-variant/10"
            >
              <GymSelector onSelect={() => setIsChangingGym(false)} />
              {user.gymId && (
                <button 
                  onClick={() => setIsChangingGym(false)}
                  className="w-full mt-4 py-4 text-on-surface-variant font-label text-xs font-black uppercase tracking-widest hover:underline"
                >
                  CANCELAR
                </button>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="ranking"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Gym Stats Summary */}
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-xl flex items-center justify-between">
                  <div>
                    <Trophy className="text-prize-gold mb-2" size={24} fill="currentColor" />
                    <div className="font-headline italic font-black text-2xl text-on-surface">#{user.positions?.league || '-'}</div>
                    <p className="text-on-surface-variant font-label text-[8px] uppercase font-bold">RANK GLOBAL LIGA BETA</p>
                  </div>
                  <div className="text-right">
                    <p className="font-label text-[10px] font-black text-primary uppercase tracking-[0.2em]">PONTOS</p>
                    <h3 className="font-headline italic font-black text-2xl text-on-surface leading-none">{(user.score || 0).toLocaleString()}</h3>
                  </div>
                </div>
              </div>

              {/* Gym Ranking Component */}
              <GymRanking gymId={user.gymId} gymName={user.gymName || ''} />

              {/* Info Section */}
              <section className="bg-surface-container-high p-6 rounded-3xl border border-outline-variant/10 flex items-start gap-4">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary shrink-0">
                  <Info size={20} />
                </div>
                <div className="space-y-1">
                  <h4 className="font-headline italic font-black text-sm text-on-surface uppercase tracking-tight">COMO FUNCIONA O RANKING?</h4>
                  <p className="text-on-surface-variant font-label text-[9px] uppercase font-bold leading-relaxed">
                    Sua pontuação é atualizada em tempo real conforme você valida seus treinos e cardios. 
                    O campeão da unidade ganha badges exclusivas e destaque no feed social.
                  </p>
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <ActivityInfoPopup type="workout" isOpen={showInfo} onClose={() => setShowInfo(false)} />
    </div>
  );
}
