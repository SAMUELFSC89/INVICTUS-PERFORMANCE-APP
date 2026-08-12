import React, { useState, useEffect } from 'react';
import { Check, X, AlertTriangle, UserMinus, ShieldAlert, Eye, Search, Filter, Clock, DollarSign, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, orderBy } from 'firebase/firestore';
import { Workout, UserProfile } from '../types';
import { useNavigate } from 'react-router-dom';
import { userService } from '../services/userService';
import { cn } from '../lib/utils';

export function AdminWorkouts() {
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'valid' | 'invalid' | 'suspicious'>('pending');
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (selectedWorkout) {
      const fetchUser = async () => {
        const userRef = doc(db, 'users', selectedWorkout.userId);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          setSelectedUser(snap.data() as UserProfile);
        }
      };
      fetchUser();
    } else {
      setSelectedUser(null);
    }
  }, [selectedWorkout]);

  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, 'workouts'),
      where('status', '==', filter),
      orderBy('timestamp', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Workout)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'workouts');
    });

    return () => unsub();
  }, [filter]);

  const handleAction = async (workout: Workout, action: 'valid' | 'invalid' | 'suspicious') => {
    try {
      // If invalidating a previously valid workout, remove points
      if (workout.status === 'valid' && action === 'invalid') {
        const userRef = doc(db, 'users', workout.userId);
        let userSnap;
        try {
          userSnap = await getDoc(userRef);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${workout.userId}`);
          throw error;
        }
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          try {
            await updateDoc(userRef, {
              score: (userData.score || 0) - (workout.points || 10)
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, `users/${workout.userId}`);
            throw error;
          }
        }
      }
      
      try {
        await updateDoc(doc(db, 'workouts', workout.id), { status: action });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `workouts/${workout.id}`);
        throw error;
      }
      
      if (action === 'suspicious' || action === 'invalid') {
        const userRef = doc(db, 'users', workout.userId);
        let userSnap;
        try {
          userSnap = await getDoc(userRef);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${workout.userId}`);
          throw error;
        }
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const newInfractions = (userData.infractions || 0) + 1;
          const updates: any = { infractions: newInfractions };
          
          if (newInfractions === 2) {
            updates.score = (userData.score || 0) - 50;
          } else if (newInfractions >= 3) {
            updates.isBanned = true;
          }
          
          try {
            await updateDoc(userRef, updates);
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, `users/${workout.userId}`);
            throw error;
          }
        }
      }

      setSelectedWorkout(null);
    } catch (err) {
      console.error("Action failed:", err);
    }
  };

  const handleBanUser = async (userId: string) => {
    if (!window.confirm("Tem certeza que deseja banir este usuário permanentemente?")) return;
    try {
      await updateDoc(doc(db, 'users', userId), { isBanned: true });
      alert("Usuário banido com sucesso.");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const filteredWorkouts = workouts.filter(w => 
    w.userId.toLowerCase().includes(searchTerm.toLowerCase()) || 
    w.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="px-6 py-12 space-y-4">
        <button 
          onClick={() => navigate('/admin')}
          className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label text-[10px] font-black uppercase tracking-widest mb-4"
        >
          <ArrowRight className="rotate-180" size={14} /> VOLTAR AO PAINEL
        </button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="text-primary" size={32} />
            <h1 className="font-headline italic font-black text-4xl uppercase tracking-tighter text-on-surface">VALIDAÇÃO ADMIN</h1>
          </div>
          <button 
            onClick={() => window.location.href = '/admin/payouts'}
            className="bg-prize-gold/10 text-prize-gold px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-prize-gold/20 transition-all"
          >
            <DollarSign size={14} /> GESTÃO DE INCENTIVOS
          </button>
        </div>
        <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest">Gerencie as atividades e mantenha a competição justa</p>
      </header>

      <div className="px-6 space-y-6">
        {/* Filters & Search */}
        <div className="flex flex-col gap-4">
          <div className="flex bg-surface-container-low p-1 rounded-2xl border border-outline-variant/10">
            {(['pending', 'valid', 'invalid', 'suspicious'] as const).map((s) => (
              <button
                key={s}
                id={`filter-${s}`}
                onClick={() => setFilter(s)}
                className={cn(
                  "flex-1 py-3 rounded-xl font-label text-[10px] font-bold uppercase tracking-widest transition-all",
                  filter === s ? "bg-primary text-on-primary shadow-lg" : "text-on-surface-variant hover:bg-surface-container-high"
                )}
              >
                {s === 'pending' ? 'Pendentes' : s === 'valid' ? 'Válidos' : s === 'invalid' ? 'Inválidos' : 'Suspeitos'}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
            <input 
              type="text"
              id="workout-search-input"
              placeholder="BUSCAR POR ID DE USUÁRIO OU TIPO..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-2xl py-4 pl-12 pr-4 font-label text-xs uppercase tracking-widest outline-none focus:border-primary transition-all"
            />
          </div>
        </div>

        {/* Workouts List */}
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredWorkouts.length === 0 ? (
            <div className="text-center py-20 space-y-4">
              <div className="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mx-auto opacity-20">
                <Check size={32} />
              </div>
              <p className="font-label text-xs text-on-surface-variant uppercase tracking-widest">Nenhuma atividade encontrada</p>
            </div>
          ) : (
            filteredWorkouts.map((workout) => (
              <motion.div 
                layout
                key={workout.id}
                className="bg-surface-container-low p-4 rounded-3xl border border-outline-variant/10 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-surface-container-high border border-outline-variant/20 relative group">
                    {workout.photoUrl ? (
                      <img 
                        src={workout.photoUrl} 
                        alt="Workout" 
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover" 
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-on-surface-variant">
                        <Clock size={24} />
                      </div>
                    )}
                    <button 
                      onClick={() => setSelectedWorkout(workout)}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                    >
                      <Eye size={20} />
                    </button>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-headline italic font-bold text-lg uppercase leading-tight">{workout.type}</span>
                    <span className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest">USER: {workout.userId.slice(0, 8)}...</span>
                    <span className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest">{new Date(workout.timestamp).toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {filter !== 'valid' && (
                    <button 
                      onClick={() => handleAction(workout, 'valid')}
                      className="w-10 h-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center hover:bg-primary hover:text-on-primary transition-all"
                    >
                      <Check size={20} />
                    </button>
                  )}
                  {filter !== 'suspicious' && (
                    <button 
                      onClick={() => handleAction(workout, 'suspicious')}
                      className="w-10 h-10 bg-alert-orange/10 text-alert-orange rounded-xl flex items-center justify-center hover:bg-alert-orange hover:text-white transition-all"
                    >
                      <AlertTriangle size={20} />
                    </button>
                  )}
                  {filter !== 'invalid' && (
                    <button 
                      onClick={() => handleAction(workout, 'invalid')}
                      className="w-10 h-10 bg-error/10 text-error rounded-xl flex items-center justify-center hover:bg-error hover:text-white transition-all"
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedWorkout && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
              onClick={() => setSelectedWorkout(null)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-lg bg-surface-container rounded-[40px] overflow-hidden shadow-2xl"
            >
              <div className="aspect-[4/5] w-full bg-surface-container-high relative">
                {selectedWorkout.photoUrl ? (
                  <img 
                    src={selectedWorkout.photoUrl} 
                    alt="Workout Detail" 
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-on-surface-variant gap-4">
                    <Clock size={64} />
                    <p className="font-label font-bold uppercase tracking-widest">Sem foto disponível</p>
                  </div>
                )}
                <button 
                  onClick={() => setSelectedWorkout(null)}
                  className="absolute top-6 right-6 w-12 h-12 bg-black/50 text-white rounded-full flex items-center justify-center backdrop-blur-md"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h2 className="font-headline italic font-black text-3xl uppercase tracking-tight">{selectedWorkout.type}</h2>
                    <p className="font-label text-xs text-on-surface-variant uppercase tracking-widest">ID: {selectedWorkout.id}</p>
                  </div>
                  <div className="bg-primary/10 text-primary px-4 py-2 rounded-xl font-headline italic font-black text-xl">
                    +{(selectedWorkout as any).points || 0} PTS
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-surface-container-low p-4 rounded-2xl border border-outline-variant/10">
                    <span className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest block mb-1">DATA/HORA</span>
                    <span className="font-label font-bold text-xs uppercase">{new Date(selectedWorkout.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="bg-surface-container-low p-4 rounded-2xl border border-outline-variant/10">
                    <span className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest block mb-1">USUÁRIO</span>
                    <span className="font-label font-bold text-xs uppercase">{selectedUser?.displayName || selectedWorkout.userId.slice(0, 12)}</span>
                  </div>
                </div>

                {selectedUser && (
                  <div className="bg-primary/5 p-4 rounded-2xl border border-primary/20 space-y-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-label text-[9px] text-primary uppercase tracking-widest block mb-1">LIGA ATUAL</span>
                        <span className="font-headline italic font-bold text-lg text-on-surface uppercase">
                          {selectedUser.league}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-4">
                  <button 
                    onClick={() => handleAction(selectedWorkout, 'valid')}
                    className="flex-1 h-16 bg-primary text-on-primary rounded-2xl font-headline italic font-black text-lg uppercase tracking-widest shadow-lg shadow-primary/20"
                  >
                    VALIDAR
                  </button>
                  <button 
                    onClick={() => handleAction(selectedWorkout, 'suspicious')}
                    className="flex-1 h-16 bg-alert-orange text-white rounded-2xl font-headline italic font-black text-lg uppercase tracking-widest shadow-lg shadow-alert-orange/20"
                  >
                    SUSPEITO
                  </button>
                  <button 
                    onClick={() => handleAction(selectedWorkout, 'invalid')}
                    className="flex-1 h-16 bg-error text-white rounded-2xl font-headline italic font-black text-lg uppercase tracking-widest shadow-lg shadow-error/20"
                  >
                    INVALIDAR
                  </button>
                </div>

                <button 
                  onClick={() => handleBanUser(selectedWorkout.userId)}
                  className="w-full flex items-center justify-center gap-2 text-error font-label font-bold text-[10px] uppercase tracking-widest hover:underline"
                >
                  <UserMinus size={16} />
                  BANIR USUÁRIO PERMANENTEMENTE
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
