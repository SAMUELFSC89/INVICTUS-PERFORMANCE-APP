import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { UserProfile, Achievement } from '../types';
import { userService } from '../services/userService';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, Flame, ArrowLeft, Heart, Trophy, Zap, Award, Share2, Check, Dumbbell, Building2, Globe } from 'lucide-react';
import { ACHIEVEMENTS } from '../achievements';
import { cn } from '../lib/utils';
import { getLevelFromXP } from '../lib/levelUtils';

export function PublicProfile() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [likeLoading, setLikeLoading] = useState(false);
  const [hasLiked, setHasLiked] = useState(false);
  const [activeTab, setActiveTab] = useState<'achievements' | 'activity'>('achievements');

  useEffect(() => {
    if (!userId) return;

    const fetchProfile = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/profile?id=${userId}`);
        if (!response.ok) {
           if (response.status === 404) navigate('/rankings');
           throw new Error('Falha ao carregar perfil');
        }
        
        const profile = await response.json();
        setUser(profile as UserProfile);
        
        const currentUserId = auth.currentUser?.uid;
        if (currentUserId && profile.profileLikes?.includes(currentUserId)) {
          setHasLiked(true);
        } else {
          setHasLiked(false);
        }
      } catch (error) {
        console.error('Error fetching public profile:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [userId, navigate]);

  const handleLike = async () => {
    if (!userId || !auth.currentUser || hasLiked) return;
    setLikeLoading(true);
    try {
      await userService.likeProfile(userId);
      setHasLiked(true);
    } catch (error) {
      console.error('Error liking profile:', error);
    } finally {
      setLikeLoading(false);
    }
  };

  const handleShareProfile = async () => {
    if (!user) return;
    const text = `🔥 Confira o perfil no INVICTUS de ${user.displayName}!
🏋️ Academia: #${user.positions.gym || '-'}
🏙️ Cidade: #${user.positions.city || '-'}
🇧🇷 Nacional: #${user.positions.national || '-'}
🔥 Streak: ${user.streak} dias`;
    const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
    const shareUrl = window.location.href.replace(window.location.origin, baseUrl.replace(/\/$/, ''));

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Perfil de ${user.displayName} - INVICTUS`,
          text: text,
          url: shareUrl,
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      navigator.clipboard.writeText(`${text}\n${shareUrl}`);
      alert('Link do perfil copiado!');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const unlockedAchievements = ACHIEVEMENTS.filter(a => user.achievements?.includes(a.id));
  const isTop3 = user.positions.league && user.positions.league <= 3;
  const isMe = auth.currentUser?.uid === user.uid;

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-outline-variant/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="text-on-surface hover:text-primary transition-colors">
            <ArrowLeft size={24} />
          </button>
          <h1 className="font-headline italic font-black text-xl uppercase tracking-tighter">ATLETA</h1>
        </div>
        <button onClick={handleShareProfile} className="p-2 text-on-surface-variant hover:text-primary">
          <Share2 size={20} />
        </button>
      </header>

      {/* Profile Info */}
      <section className="px-6 py-12 bg-surface-container-low/30 border-b border-outline-variant/5">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-8 md:gap-12">
            <div className={cn(
              "w-32 h-32 md:w-40 md:h-40 rounded-[48px] p-1 overflow-hidden transition-all duration-500",
              isTop3 ? "bg-gradient-to-br from-primary via-alert-orange to-yellow-500 shadow-[0_0_40px_rgba(255,183,0,0.3)] rotate-3" : "bg-surface-container-highest border border-outline-variant/20 shadow-xl"
            )}>
              <img 
                src={user.photoURL || "https://picsum.photos/seed/athlete/400"} 
                alt={user.displayName} 
                className="w-full h-full rounded-[44px] object-cover bg-surface-container-high"
                referrerPolicy="no-referrer"
              />
            </div>
            
            <div className="flex-grow text-center md:text-left space-y-6">
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center gap-4 justify-center md:justify-start">
                  <h2 className="font-headline italic font-black text-4xl md:text-6xl uppercase tracking-tighter text-on-surface">
                    {user.displayName}
                  </h2>
                  {!isMe && (
                    <button
                      onClick={handleLike}
                      disabled={likeLoading || hasLiked}
                      className={cn(
                        "px-6 py-2 rounded-xl font-headline italic font-black text-sm uppercase transition-all active:scale-95 flex items-center justify-center gap-2",
                        hasLiked 
                          ? "bg-primary/20 text-primary border border-primary/20" 
                          : "bg-primary text-on-primary shadow-lg shadow-primary/20 hover:scale-105"
                      )}
                    >
                      {hasLiked ? <Check size={18} /> : <Heart size={18} fill={hasLiked ? "currentColor" : "none"} />}
                      {hasLiked ? "CONQUISTOU" : "RECONHECER"}
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-center md:justify-start gap-6">
                  <div className="flex items-center gap-2 text-primary">
                    <Heart size={18} fill="currentColor" />
                    <span className="font-black text-lg">{(user as any).profileLikes?.length || 0}</span>
                  </div>
                  <div className="bg-alert-orange/10 text-alert-orange px-4 py-1 rounded-lg font-black text-xs uppercase tracking-widest border border-alert-orange/20">
                    LIGA {user.league?.split(' ')[1]?.toUpperCase()}
                  </div>
                </div>
              </div>

              {user.bio && (
                <p className="text-on-surface-variant font-medium text-sm leading-relaxed max-w-md mx-auto md:mx-0">
                  {user.bio}
                </p>
              )}

              <div className="flex items-center justify-center md:justify-start gap-3">
                <div className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-xl border border-outline-variant/10">
                  <MapPin size={14} className="text-primary" />
                  <span className="font-black text-[10px] text-on-surface uppercase tracking-widest">{user.city || 'Brazil'}</span>
                </div>
                <div className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-xl border border-outline-variant/10">
                  <Flame size={14} className="text-alert-orange" />
                  <span className="font-black text-[10px] text-on-surface uppercase tracking-widest">{user.streak} DIAS</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Summary */}
      <section className="px-6 mb-12">
        <div className="max-w-4xl mx-auto -translate-y-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatBox label="RANK ACADEMIA" value={`#${user.positions.gym || '-'}`} subtitle={user.gymName || 'NÃO VINCULADO'} icon={<Building2 size={20} className="text-primary" />} />
            <StatBox label="RANK CIDADE" value={`#${user.positions.city || '-'}`} subtitle={user.city || 'NÃO VINCULADO'} icon={<MapPin size={20} className="text-blue-500" />} />
            <StatBox label="RANK NACIONAL" value={`#${user.positions.national || '-'}`} subtitle="BRASIL" icon={<Globe size={20} className="text-yellow-500" />} />
            <StatBox label="SCORE RANKING" value={(user.score || 0).toLocaleString()} subtitle="COMPETITIVO" icon={<Trophy size={20} className="text-prize-gold" />} />
            <StatBox label="EXPERIÊNCIA" value={`${(user.xp || 0).toLocaleString()} XP`} subtitle={`LEVEL ${getLevelFromXP(user.xp || 0)}`} icon={<Zap size={20} className="text-alert-orange" />} />
          </div>
        </div>
      </section>

      {/* Podium Background for Top 3 */}
      {isTop3 && (
        <section className="px-6 mb-12">
          <div className="max-w-4xl mx-auto">
            <div className="bg-gradient-to-r from-yellow-500/20 via-yellow-500/5 to-transparent border border-yellow-500/30 rounded-3xl p-8 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                <Trophy size={160} />
              </div>
              <div className="relative z-10 space-y-2">
                <div className="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center text-black font-black text-2xl shadow-lg mb-2">
                  #{user.positions.league}
                </div>
                <h3 className="font-headline italic font-black text-2xl text-on-surface uppercase tracking-tighter">ELITE DA DISCIPLINA</h3>
                <p className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">RANK ATUAL: TOP 3 DA TEMPORADA</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Tabs */}
      <section className="max-w-4xl mx-auto px-6">
        <div className="flex gap-8 border-b border-outline-variant/10 mb-8">
          <button 
            onClick={() => setActiveTab('achievements')}
            className={cn(
              "pb-4 border-b-2 font-black text-xs uppercase tracking-widest transition-all",
              activeTab === 'achievements' ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface opacity-50"
            )}
          >
            CONQUISTAS
          </button>
          <button 
            onClick={() => setActiveTab('activity')}
            className={cn(
              "pb-4 border-b-2 font-black text-xs uppercase tracking-widest transition-all",
              activeTab === 'activity' ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface opacity-50"
            )}
          >
            TEMPORADA 01
          </button>
        </div>

        {activeTab === 'achievements' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {unlockedAchievements.length > 0 ? (
              unlockedAchievements.map((achievement) => (
                <div key={achievement.id} className="p-6 bg-surface-container border border-outline-variant/10 rounded-3xl flex items-center gap-6 group">
                  <div className="w-16 h-16 rounded-[24px] bg-primary/10 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform shrink-0">
                    {achievement.icon}
                  </div>
                  <div className="flex-grow min-w-0">
                    <h4 className="font-headline italic font-black text-lg uppercase tracking-tighter text-on-surface truncate">
                      {achievement.name}
                    </h4>
                    <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">CONQUISTA ATLETA</p>
                    <p className="text-[9px] font-medium text-on-surface-variant/60 uppercase">{achievement.criteria}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full py-20 text-center bg-surface-container-low rounded-3xl border border-dashed border-outline-variant/20">
                <Award size={48} className="mx-auto text-outline-variant/20 mb-4" />
                <p className="font-black text-xs text-on-surface-variant uppercase tracking-widest">Nenhuma conquista desbloqueada</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="space-y-4">
            <div className="p-8 bg-surface-container-low border border-outline-variant/10 rounded-3xl flex items-center justify-between">
              <div className="space-y-2">
                <h4 className="font-headline italic font-black text-2xl uppercase tracking-tighter text-on-surface">PROGRESSO ATUAL</h4>
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-black bg-primary text-on-primary px-3 py-1 rounded-full uppercase tracking-widest">EM DISPUTA</span>
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{(user.xp || 0).toLocaleString()} XP ACUMULADO</span>
                </div>
              </div>
              <div className="text-right">
                <span className="block font-headline italic font-black text-5xl text-primary leading-none">#{user.positions.national || '?'}</span>
                <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">RANK NACIONAL</span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function StatBox({ label, value, subtitle, icon }: any) {
  return (
    <div className="bg-surface-container rounded-3xl p-6 border border-outline-variant/10 shadow-lg group">
      <div className="flex items-center justify-between mb-4">
        <span className="font-black text-[9px] text-on-surface-variant uppercase tracking-[0.2em]">{label}</span>
        <div className="group-hover:scale-110 transition-transform">{icon}</div>
      </div>
      <div className="space-y-1">
        <span className="block font-headline italic font-black text-4xl text-on-surface tracking-tighter leading-none">{value}</span>
        <span className="block font-black text-[8px] text-on-surface-variant/60 uppercase tracking-widest">{subtitle}</span>
      </div>
    </div>
  );
}
