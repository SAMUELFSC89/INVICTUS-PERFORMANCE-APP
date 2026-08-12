import React, { useState, useEffect } from 'react';
import { Trophy, DollarSign, CheckCircle, Clock, Search, Filter, ArrowRight, User, ShieldAlert, Copy } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs, orderBy, limit } from 'firebase/firestore';
import { UserProfile } from '../types';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { rewardService } from '../services/rewardService';
import { rankingService } from '../services/rankingService';

interface PayoutCandidate {
  user: UserProfile;
  estimatedReward: number;
  rank: number;
  category: string;
}

export function AdminPayouts() {
  const [candidates, setCandidates] = useState<PayoutCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    const fetchCandidates = async () => {
      try {
        const totalActive = await rankingService.getActiveUserCount();
        
        const usersRef = collection(db, 'users');
        const q = query(
          usersRef, 
          where('isSubscribed', '==', true),
          orderBy('score', 'desc'),
          limit(50)
        );

        const snap = await getDocs(q);
        const userList = snap.docs.map(d => d.data() as UserProfile);

        const poolsMap: Record<string, { gym: number; city: number; national: number }> = {};
        for (const user of userList) {
          const usersInGym = user.gymId ? await rankingService.getActiveUserCount('gymId' as any, user.gymId) : 0;
          const usersInCity = user.city ? await rankingService.getActiveUserCount('city' as any, user.city) : 0;
          poolsMap[user.uid] = rewardService.calculatePools(totalActive, usersInGym, usersInCity);
        }

        const resolvedPrizes = rewardService.resolvePrizes(userList, poolsMap);
        const candidateList: PayoutCandidate[] = [];

        for (const user of userList) {
          const prizeInfo = resolvedPrizes[user.uid];
          const totalReward = prizeInfo ? prizeInfo.totalReward : 0;

          if (totalReward > 0) {
            candidateList.push({
              user,
              estimatedReward: totalReward,
              rank: user.positions?.national || 0,
              category: 'Multi-Camada'
            });
          }
        }

        setCandidates(candidateList.sort((a, b) => b.estimatedReward - a.estimatedReward));
        setLoading(false);
      } catch (error) {
        console.error('Error fetching payout candidates:', error);
        setLoading(false);
      }
    };

    fetchCandidates();
  }, []);

  const handleMarkAsPaid = async (candidate: PayoutCandidate) => {
    if (!window.confirm(`Confirmar pagamento de R$ ${candidate.estimatedReward.toFixed(2)} para ${candidate.user.displayName}?`)) return;
    
    try {
      // In a real app, we would record this in a 'payouts' collection
      // For now, we'll just log it and maybe update a field on the user
      console.log(`[Payout] Paid R$ ${candidate.estimatedReward} to ${candidate.user.uid}`);
      alert('Pagamento registrado com sucesso! (Simulação)');
    } catch (error) {
      console.error('Payout registration failed:', error);
    }
  };

  const filteredCandidates = candidates.filter(c => 
    c.user.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.user.city.toLowerCase().includes(searchTerm.toLowerCase())
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
            <DollarSign className="text-prize-gold" size={32} />
            <h1 className="font-headline italic font-black text-4xl uppercase tracking-tighter text-on-surface">GESTÃO DE INCENTIVOS</h1>
          </div>
          <button 
            onClick={() => window.location.href = '/admin/workouts'}
            className="bg-primary/10 text-primary px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-primary/20 transition-all"
          >
            <ShieldAlert size={14} /> VALIDAÇÃO
          </button>
        </div>
        <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest text-shadow-sm">Acompanhe e valide os pagamentos para os vencedores</p>
      </header>

      <div className="px-6 space-y-6">
        {/* Search */}
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
            <input 
              type="text"
              placeholder="BUSCAR ATLETA..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-2xl py-4 pl-12 pr-4 font-label text-xs uppercase tracking-widest outline-none focus:border-prize-gold transition-all"
            />
          </div>
        </div>

        {/* Candidates List */}
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-prize-gold border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredCandidates.length === 0 ? (
            <div className="text-center py-20 space-y-4">
              <div className="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mx-auto opacity-20">
                <Trophy size={32} />
              </div>
              <p className="font-label text-xs text-on-surface-variant uppercase tracking-widest">Nenhum vencedor elegível encontrado</p>
            </div>
          ) : (
            filteredCandidates.map((candidate, idx) => (
              <div 
                key={candidate.user.uid}
                className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-prize-gold/10 rounded-xl flex items-center justify-center text-prize-gold font-headline italic font-black text-xl">
                      #{candidate.rank}
                    </div>
                    <div>
                      <h3 className="font-headline italic font-black text-xl uppercase leading-tight">{candidate.user.displayName}</h3>
                      <p className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest">{candidate.category}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-label text-[9px] text-prize-gold uppercase tracking-widest font-black">INCENTIVO</p>
                    <p className="font-headline italic font-black text-2xl text-prize-gold">R$ {candidate.estimatedReward.toFixed(2)}</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-outline-variant/10 flex items-center justify-between">
                  <div className="flex gap-4">
                    <div className="flex flex-col">
                      <span className="font-label text-[8px] text-on-surface-variant uppercase tracking-widest">PONTOS</span>
                      <span className="font-label font-bold text-xs uppercase">{candidate.user.score}</span>
                    </div>
                    <div className="flex flex-col min-w-[120px]">
                      <span className="font-label text-[8px] text-prize-gold uppercase tracking-widest font-black">CHAVE PIX</span>
                      <div className="flex items-center gap-2">
                        <span className="font-label font-bold text-xs uppercase truncate max-w-[150px]">
                          {candidate.user.pixKey || 'NÃO CADASTRADA'}
                        </span>
                        {candidate.user.pixKey && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(candidate.user.pixKey!);
                              alert('Chave Pix copiada!');
                            }}
                            className="p-1 hover:text-prize-gold transition-colors"
                          >
                            <Copy size={12} />
                          </button>
                        )}
                      </div>
                      <span className="text-[7px] text-on-surface-variant uppercase font-bold">{candidate.user.pixKeyType || '-'}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => window.open(`https://wa.me/${candidate.user.phoneNumber?.replace(/\D/g, '')}`, '_blank')}
                      className="bg-surface-container-high text-on-surface px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-outline-variant/20 transition-all"
                    >
                      WHATSAPP
                    </button>
                    <button 
                      onClick={() => handleMarkAsPaid(candidate)}
                      className="bg-prize-gold text-white px-4 py-2 rounded-xl font-label text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-transform"
                    >
                      PAGO <CheckCircle size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
