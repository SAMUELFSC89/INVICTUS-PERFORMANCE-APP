import React, { useState, useEffect } from 'react';
import { 
  Trophy, 
  Settings, 
  Users, 
  Shield, 
  Activity, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Search, 
  Filter, 
  Plus, 
  Download, 
  DollarSign,
  TrendingUp,
  BarChart3,
  GanttChartSquare,
  LayoutDashboard
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { 
  collection, 
  query, 
  getDocs, 
  where, 
  orderBy, 
  limit, 
  addDoc, 
  updateDoc, 
  doc, 
  deleteDoc,
  Timestamp,
  getCountFromServer
} from 'firebase/firestore';
import { cn } from '../lib/utils';
import { eliteChallengeService, Season, EliteChallenge, UserEliteChallenge } from '../services/eliteChallengeService';

export function AdminEliteChallenges() {
  const navigate = useNavigate();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [challenges, setChallenges] = useState<EliteChallenge[]>([]);
  const [participants, setParticipants] = useState<UserEliteChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'seasons' | 'challenges' | 'participants' | 'metrics'>('seasons');

  useEffect(() => {
    const fetchAdminData = async () => {
      setLoading(true);
      try {
        const seasonSnap = await getDocs(collection(db, 'seasons'));
        setSeasons(seasonSnap.docs.map(d => ({ id: d.id, ...d.data() } as Season)));

        const challengeSnap = await getDocs(collection(db, 'elite_challenges'));
        setChallenges(challengeSnap.docs.map(d => ({ id: d.id, ...d.data() } as EliteChallenge)));

        const participantSnap = await getDocs(query(collection(db, 'user_elite_challenges'), orderBy('startDate', 'desc'), limit(50)));
        setParticipants(participantSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserEliteChallenge)));

      } catch (error) {
        console.error('Error fetching admin elite data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchAdminData();
  }, []);

  const totalPool = seasons.reduce((acc, s) => acc + (s.totalPool || 0), 0);
  const totalAthletes = seasons.reduce((acc, s) => acc + (s.athletesCount || 0), 0);

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="px-6 pt-12 pb-8 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trophy className="text-primary" size={28} />
            <h1 className="font-headline italic font-black text-3xl text-on-surface uppercase tracking-tight">ELITE ADMIN</h1>
          </div>
          <button className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg">
             <Plus size={16} /> NOVA SEASON
          </button>
        </div>
        <p className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest leading-none">Gestão de temporadas, pools e antifraude elite</p>
      </header>

      <div className="px-6 space-y-8">
        {/* Metrics Bar */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatMini label="POOL TOTAL" value={`R$ ${totalPool.toLocaleString()}`} color="text-primary" />
          <div className="bg-surface-container p-4 rounded-3xl border border-white/5">
             <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest mb-1">ATLETAS ELITE</p>
             <p className="font-headline italic font-black text-xl">{totalAthletes.toLocaleString()}</p>
          </div>
          <div className="bg-surface-container p-4 rounded-3xl border border-white/5">
             <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest mb-1">DESAFIOS ATIVOS</p>
             <p className="font-headline italic font-black text-xl">{challenges.length}</p>
          </div>
          <div className="bg-surface-container p-4 rounded-3xl border border-white/5">
             <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest mb-1">PAYOUT ESTIMADO</p>
             <p className="font-headline italic font-black text-xl text-secondary">R$ {(totalPool * 0.4).toLocaleString()}</p>
          </div>
        </section>

        {/* Tab Navigation */}
        <nav className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
           <TabButton active={activeTab === 'seasons'} label="TEMPORADAS" onClick={() => setActiveTab('seasons')} />
           <TabButton active={activeTab === 'challenges'} label="DESAFIOS" onClick={() => setActiveTab('challenges')} />
           <TabButton active={activeTab === 'participants'} label="PARTICIPANTES" onClick={() => setActiveTab('participants')} />
           <TabButton active={activeTab === 'metrics'} label="MÉTRICAS & POOLS" onClick={() => setActiveTab('metrics')} />
        </nav>

        {/* Content Area */}
        <div className="space-y-6">
           {activeTab === 'seasons' && (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {seasons.map(season => (
                  <div key={season.id} className="bg-surface-container p-6 rounded-[32px] border border-white/5 flex justify-between items-start">
                     <div className="space-y-3">
                        <div className="flex items-center gap-2">
                           <span className={cn(
                             "px-2 py-0.5 rounded text-[8px] font-black uppercase",
                             season.status === 'active' ? 'bg-primary text-black' : 'bg-white/10 text-on-surface-variant'
                           )}>{season.status}</span>
                           <h4 className="font-headline italic font-black text-xl leading-none">{season.name} {season.theme}</h4>
                        </div>
                        <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest italic opacity-60">"{season.description}"</p>
                        <div className="flex gap-4">
                           <MetricMini label="ATLETAS" value={season.athletesCount.toString()} />
                           <MetricMini label="POOL" value={`R$ ${season.totalPool.toLocaleString()}`} />
                        </div>
                     </div>
                     <button className="text-on-surface-variant hover:text-primary"><Settings size={20} /></button>
                  </div>
                ))}
             </div>
           )}

           {activeTab === 'participants' && (
             <div className="bg-surface-container p-1 rounded-[32px] border border-white/5 overflow-hidden">
                <table className="w-full text-left">
                   <thead className="bg-white/5 border-b border-white/5">
                      <tr>
                         <th className="px-6 py-4 font-headline italic font-black text-[10px] uppercase tracking-widest text-on-surface-variant">ATLETA</th>
                         <th className="px-6 py-4 font-headline italic font-black text-[10px] uppercase tracking-widest text-on-surface-variant">DESAFIO</th>
                         <th className="px-6 py-4 font-headline italic font-black text-[10px] uppercase tracking-widest text-on-surface-variant">PROGRESSO</th>
                         <th className="px-6 py-4 font-headline italic font-black text-[10px] uppercase tracking-widest text-on-surface-variant">INCENTIVO EST.</th>
                         <th className="px-6 py-4 font-headline italic font-black text-[10px] uppercase tracking-widest text-on-surface-variant">STATUS</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5">
                      {participants.map(p => (
                        <tr key={p.id} className="hover:bg-white/5 transition-colors cursor-pointer group">
                           <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                 <img 
                                   src={p.userPhoto || "https://picsum.photos/seed/athlete/100"} 
                                   referrerPolicy="no-referrer" 
                                   onError={(e) => {
                                     const target = e.target as HTMLImageElement;
                                     target.src = "https://picsum.photos/seed/athlete/100";
                                   }}
                                   className="w-8 h-8 rounded-lg object-cover border border-white/10" 
                                   alt="" 
                                 />
                                 <span className="font-bold text-xs">{p.userName}</span>
                              </div>
                           </td>
                           <td className="px-6 py-4">
                              <span className="font-headline italic font-black text-xs uppercase tracking-tight">{p.challengeId.split('_')[0]}</span>
                           </td>
                           <td className="px-6 py-4">
                              <div className="flex flex-col gap-1">
                                 <span className="font-mono text-[10px] font-bold">{p.currentKm} / {p.targetKm} KM</span>
                                 <div className="h-1 w-24 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-primary" style={{ width: `${(p.currentKm / p.targetKm) * 100}%` }} />
                                 </div>
                              </div>
                           </td>
                           <td className="px-6 py-4 font-headline italic font-black text-primary text-sm">R$ {p.estimatedPrize.toLocaleString()}</td>
                           <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest",
                                p.status === 'active' ? 'bg-white/5 text-on-surface' : p.status === 'completed' ? 'bg-primary/20 text-primary' : 'bg-red-500/20 text-red-500'
                              )}>{p.status}</span>
                           </td>
                        </tr>
                      ))}
                   </tbody>
                </table>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}

function StatMini({ label, value, color }: { label: string, value: string, color?: string }) {
  return (
    <div className="bg-surface-container p-4 rounded-3xl border border-white/5">
       <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest mb-1">{label}</p>
       <p className={cn("font-headline italic font-black text-xl", color)}>{value}</p>
    </div>
  );
}

function MetricMini({ label, value }: { label: string, value: string }) {
  return (
    <div>
       <p className="font-label text-[7px] font-black text-on-surface-variant uppercase tracking-widest opacity-60">{label}</p>
       <p className="font-headline italic font-black text-[12px]">{value}</p>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "px-6 py-2.5 rounded-xl font-label text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
        active ? "bg-primary text-black" : "bg-surface-container text-on-surface-variant/40 border border-white/5 hover:text-on-surface"
      )}
    >
      {label}
    </button>
  );
}
