import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, CheckCircle, Share2, X } from 'lucide-react';
import { auth, db, onAuthStateChanged } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { UserProfile, Achievement } from '../types';
import { ACHIEVEMENTS } from '../achievements';
import { userService } from '../services/userService';
import { cn } from '../lib/utils';

import { useUser } from '../UserContext';

export function AchievementTracker() {
  const { user } = useUser();
  const [newAchievement, setNewAchievement] = useState<Achievement | null>(null);
  const [lastAchievementCheck, setLastAchievementCheck] = useState<string[]>([]);

  useEffect(() => {
    if (user) {
      handleUserUpdate(user);
    }
  }, [user]);

  const handleUserUpdate = (userData: UserProfile) => {
    // Avoid re-checking if achievements haven't changed in the doc
    // but we need to check if they *should* be unlocked
    const unlockedIds = userData.achievements || [];
    const newlyUnlocked = ACHIEVEMENTS.find(achievement => {
      if (unlockedIds.includes(achievement.id)) return false;
      
      try {
        const criteria = achievement.criteria;
        const context = {
          streak: userData.streak || 0,
          totalWorkouts: userData.totalWorkouts || 0,
          totalActiveDays: userData.totalActiveDays || 0,
          positions: userData.positions || { league: 0 },
          referralStats: userData.referralStats || { validReferrals: 0 }
        };

        if (criteria.includes('streak')) {
          const val = parseInt(criteria.split('>=')[1]);
          return context.streak >= val;
        }
        if (criteria.includes('totalWorkouts')) {
          const val = parseInt(criteria.split('>=')[1]);
          return context.totalWorkouts >= val;
        }
        if (criteria.includes('positions.league')) {
          const val = parseInt(criteria.split('<=')[1]);
          return context.positions.league > 0 && context.positions.league <= val;
        }
        if (criteria.includes('referralStats.validReferrals')) {
          const val = parseInt(criteria.split('>=')[1]);
          return context.referralStats.validReferrals >= val;
        }

        return false;
      } catch (e) {
        console.error("Error evaluating achievement criteria:", e);
        return false;
      }
    });

    if (newlyUnlocked) {
      userService.unlockAchievement(newlyUnlocked.id);
      setNewAchievement(newlyUnlocked);
      setTimeout(() => setNewAchievement(null), 5000);
    }
  };

  const handleShare = () => {
    if (!newAchievement || !user) return;
    const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
    const text = `Acabei de desbloquear a conquista "${newAchievement.name}" no INVICTUS! 🏆🔥\n\n${newAchievement.description}\n\nVenha treinar comigo: ${baseUrl.replace(/\/$/, '')}/invite?ref=${user.uid}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <AnimatePresence>
      {newAchievement && (
        <motion.div
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 20, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          className="fixed top-0 left-4 right-4 z-[200] flex justify-center"
        >
          <div className="bg-surface-container border border-primary/30 rounded-3xl p-6 shadow-2xl flex items-center gap-6 max-w-md w-full relative overflow-hidden">
            <div className="absolute inset-0 bg-primary/5 animate-pulse"></div>
            
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-4xl relative z-10">
              {newAchievement.icon}
            </div>

            <div className="flex-grow space-y-1 relative z-10">
              <span className="font-label text-[10px] font-black text-primary uppercase tracking-widest block">NOVA CONQUISTA!</span>
              <h3 className="font-headline italic font-black text-xl text-on-surface uppercase leading-none tracking-tight">
                {newAchievement.name}
              </h3>
              <p className="text-on-surface-variant font-label text-[10px] uppercase font-bold">
                {newAchievement.description}
              </p>
            </div>

            <div className="flex flex-col gap-2 relative z-10">
              <button 
                onClick={handleShare}
                className="w-10 h-10 bg-primary text-on-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20"
              >
                <Share2 size={18} />
              </button>
              <button 
                onClick={() => setNewAchievement(null)}
                className="w-10 h-10 bg-surface-container-highest text-on-surface-variant rounded-xl flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
