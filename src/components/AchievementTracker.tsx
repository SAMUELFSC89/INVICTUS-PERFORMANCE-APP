import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Share2, X } from 'lucide-react';
import { Achievement } from '../types';
import { ACHIEVEMENTS } from '../achievements';
import { useUser } from '../UserContext';

export function AchievementTracker() {
  const { user } = useUser();
  const [newAchievement, setNewAchievement] = useState<Achievement | null>(null);
  const knownAchievementIds = useRef<Set<string> | null>(null);
  const knownUserId = useRef<string | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) {
      knownAchievementIds.current = null;
      knownUserId.current = null;
      setNewAchievement(null);
      return;
    }

    const unlockedIds = new Set(user.achievements || []);
    if (!knownAchievementIds.current || knownUserId.current !== user.uid) {
      knownAchievementIds.current = unlockedIds;
      knownUserId.current = user.uid;
      return;
    }

    const newlyUnlockedId = [...unlockedIds].find(id => !knownAchievementIds.current?.has(id));
    knownAchievementIds.current = unlockedIds;
    if (!newlyUnlockedId) return;

    const newlyUnlocked = ACHIEVEMENTS.find(achievement => achievement.id === newlyUnlockedId);
    if (!newlyUnlocked) return;

    setNewAchievement(newlyUnlocked);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setNewAchievement(null), 5000);
  }, [user]);

  useEffect(() => () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  const handleShare = () => {
    if (!newAchievement || !user) return;
    const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
    const text = `Acabei de desbloquear a conquista "${newAchievement.name}" no INVICTUS! 🏆🔥\n\n${newAchievement.description}\n\nVenha treinar comigo: ${baseUrl.replace(/\/$/, '')}/invite?ref=${user.uid}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const content = (
    <AnimatePresence>
      {newAchievement && (
        <motion.div
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          className="fixed left-4 right-4 z-[9200] flex justify-center"
          style={{ top: 'max(env(safe-area-inset-top, 0px), 14px)' }}
        >
          <div className="relative flex w-full max-w-md items-center gap-5 overflow-hidden rounded-3xl border border-[#F5A623]/30 bg-[#11100E]/98 p-5 text-white shadow-2xl backdrop-blur-xl">
            <div className="absolute inset-0 animate-pulse bg-[#F5A623]/5" />
            <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F5A623]/10 text-3xl">{newAchievement.icon}</div>
            <div className="relative z-10 flex-grow space-y-1">
              <span className="block font-label text-[10px] font-black uppercase tracking-widest text-[#F5A623]">NOVA CONQUISTA!</span>
              <h3 className="font-headline text-xl font-black uppercase italic leading-none tracking-tight text-white">{newAchievement.name}</h3>
              <p className="font-label text-[10px] font-bold uppercase text-white/55">{newAchievement.description}</p>
            </div>
            <div className="relative z-10 flex flex-col gap-2">
              <button onClick={handleShare} className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F5A623] text-black"><Share2 size={18} /></button>
              <button onClick={() => setNewAchievement(null)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/8 text-white/60"><X size={18} /></button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
