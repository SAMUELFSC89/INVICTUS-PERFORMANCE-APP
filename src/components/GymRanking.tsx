import React, { useState, useEffect } from 'react';
import { Trophy, Medal, Star, Flame, Loader2, Dumbbell, MapPin, Zap, User } from 'lucide-react';
import { rankingService } from '../services/rankingService';
import { RankingEntry } from '../types';
import { useUser } from '../UserContext';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';

export function GymRanking({ gymId, gymName }: { gymId: string; gymName: string }) {
  const { user } = useUser();
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePeriod, setActivePeriod] = useState<'all' | 'weekly' | 'monthly'>('all');

  useEffect(() => {
    const loadRanking = async () => {
      if (!gymId) return;
      setLoading(true);
      try {
        const data = await rankingService.getRanking('gym', gymId, activePeriod);
        setRanking(data.topUsers);
      } catch (error) {
        console.error('Error loading gym ranking:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRanking();
  }, [gymId, activePeriod, user?.score, user?.streak]);

  const userRank = ranking.find(r => r.uid === user?.uid)?.rank;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Loader2 className="animate-spin text-primary" size={48} />
        <p className="font-label text-xs font-black text-primary uppercase animate-pulse">Carregando ranking da unidade...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface-container-low border border-primary/20 p-6 rounded-[40px] shadow-xl relative overflow-hidden group">
        <div className="absolute -right-4 -top-4 w-32 h-32 bg-primary/10 rounded-full blur-3xl group-hover:bg-primary/20 transition-colors"></div>
        <div className="flex items-center gap-4 relative z-10">
          <div className="w-14 h-14 bg-primary/20 rounded-2xl flex items-center justify-center text-primary shadow-lg">
            <Dumbbell size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <MapPin size={12} className="text-primary" />
              <p className="font-label text-[10px] font-black text-primary uppercase tracking-[0.2em]">RANKING DA UNIDADE</p>
            </div>
            <h3 className="font-headline italic font-black text-2xl text-on-surface uppercase tracking-tight">{gymName}</h3>
          </div>
        </div>
        
        {/* Period Filter */}
        <div className="flex gap-2 mt-6">
          {(['all', 'weekly', 'monthly'] as const).map((period) => (
            <button
              key={period}
              onClick={() => setActivePeriod(period)}
              className={cn(
                "flex-1 py-2 rounded-2xl font-label text-[9px] font-black uppercase tracking-widest transition-all border",
                activePeriod === period
                  ? "bg-primary text-white border-primary shadow-lg shadow-primary/20"
                  : "bg-surface-container-high text-on-surface-variant border-outline-variant/10 hover:bg-surface-container-highest"
              )}
            >
              {period === 'all' ? 'Geral' : period === 'weekly' ? 'Semanal' : 'Mensal'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {ranking.length === 0 ? (
          <div className="text-center py-12 bg-surface-container-low rounded-3xl border border-dashed border-outline-variant/30">
            <p className="text-on-surface-variant font-label text-xs uppercase font-bold">Ainda não há competidores nesta academia.</p>
            <p className="text-primary font-label text-[10px] uppercase font-black mt-2">SEJA O PRIMEIRO A PONTUAR!</p>
          </div>
        ) : (
          ranking.map((entry, index) => {
            const isCurrentUser = entry.uid === user?.uid;
            const isTop3 = index < 3;

            return (
              <motion.div
                key={entry.uid}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`p-4 rounded-3xl flex items-center gap-4 border transition-all ${
                  isCurrentUser 
                    ? 'bg-primary/10 border-primary/30 shadow-lg shadow-primary/5' 
                    : 'bg-surface-container-low border-outline-variant/10'
                }`}
              >
                <div className="w-8 sm:w-10 flex flex-col items-center justify-center">
                  {index === 0 ? (
                    <Trophy className="text-prize-gold w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" />
                  ) : index === 1 ? (
                    <Medal className="text-slate-400 w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" />
                  ) : index === 2 ? (
                    <Medal className="text-amber-700 w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" />
                  ) : (
                    <span className="font-headline italic font-black text-lg sm:text-xl text-on-surface-variant">#{index + 1}</span>
                  )}
                </div>

                <div className="relative">
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl overflow-hidden border-2 ${isTop3 ? 'border-prize-gold' : 'border-outline-variant/20'}`}>
                    <img 
                      src={entry.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.uid}`} 
                      alt={entry.displayName} 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {isCurrentUser && (
                    <div className="absolute -top-1 -right-1 w-3.5 h-3.5 sm:w-4 sm:h-4 bg-primary rounded-full border-2 border-background flex items-center justify-center">
                      <Star size={7} fill="white" className="text-white" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className={`font-headline italic font-black text-sm sm:text-base truncate uppercase leading-tight ${isCurrentUser ? 'text-primary' : 'text-on-surface'}`}>
                      {entry.displayName}
                    </h4>
                    {entry.isSubscribed && (
                      <span className="bg-prize-gold/20 text-prize-gold text-[7px] sm:text-[8px] font-black px-1 sm:px-1.5 py-0.5 rounded-full uppercase">PRO</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 mt-1">
                    <div className="flex items-center gap-1">
                      <Flame size={10} className="text-primary sm:w-3 sm:h-3" fill="currentColor" />
                      <span className="font-label text-[9px] sm:text-[10px] font-black text-on-surface-variant">{entry.streak}D</span>
                    </div>
                    {index === 0 && (
                      <span className="bg-primary/10 text-primary text-[7px] sm:text-[8px] font-black px-1.5 sm:px-2 py-0.5 rounded-full uppercase tracking-tighter">LÍDER</span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className={`font-headline italic font-black text-lg sm:text-xl leading-none ${isTop3 ? 'text-prize-gold' : 'text-on-surface'}`}>
                    {(entry.score || 0).toLocaleString()}
                  </div>
                  <p className="text-on-surface-variant font-label text-[7px] sm:text-[8px] uppercase font-bold mt-1">PTS</p>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {user?.gymId === gymId && (
        <div className={cn(
          "bg-surface-container-high p-6 rounded-3xl border flex flex-col items-center text-center space-y-3 transition-all",
          userRank && userRank <= 3 ? "border-prize-gold shadow-lg shadow-prize-gold/10" : "border-primary/30"
        )}>
          <div className="flex items-center gap-2 mb-1">
            <User className="text-primary" size={12} />
            <p className="text-on-surface-variant font-label text-[10px] uppercase font-black tracking-widest">
              SUA POSIÇÃO NESTA UNIDADE
            </p>
          </div>
          <div className="flex items-center gap-8">
            <div className="flex flex-col items-center">
              <span className={cn(
                "font-headline italic font-black text-4xl leading-none",
                userRank && userRank <= 3 ? "text-prize-gold" : "text-primary"
              )}>
                #{userRank || '-'}
              </span>
              <span className="text-on-surface-variant font-label text-[8px] uppercase font-bold tracking-[0.2em] mt-1">POSIÇÃO</span>
            </div>
            <div className="w-px h-10 bg-outline-variant/30"></div>
            <div className="flex flex-col items-center">
              <span className="font-headline italic font-black text-4xl text-on-surface leading-none">
                {activePeriod === 'weekly' ? (user?.weeklyScore || 0).toLocaleString() : activePeriod === 'monthly' ? (user?.monthlyScore || 0).toLocaleString() : (user?.score || 0).toLocaleString()}
              </span>
              <span className="text-on-surface-variant font-label text-[8px] uppercase font-bold tracking-[0.2em] mt-1">PONTOS</span>
            </div>
          </div>
          {userRank && userRank > 1 && (
            <p className="text-[9px] font-bold text-primary uppercase tracking-widest animate-pulse mt-2">
              QUASE LÁ! CONTINUE TREINANDO PARA SUBIR
            </p>
          )}
        </div>
      )}
    </div>
  );
}
