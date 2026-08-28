import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Dumbbell, Activity, Trophy } from 'lucide-react';
import { championshipService } from '../../services/championshipService';
import { Championship, ChampionshipRegistration, UserChampionshipProgress } from '../../types/championships';
import { useUser } from '../../UserContext';
import { AthleteIllustration } from './AthleteIllustration';

/**
 * Ate 2026-08 esta tela tinha 2 cards TOTALMENTE fixos no codigo -- "Arena
 * 30D: Ativo" e "Run Elite 30D: Inscrição Realizada, Início em 5 dias" --
 * aparecendo pra QUALQUER usuario logado, mesmo quem nunca se inscreveu em
 * nada. Agora so mostra os campeonatos em que o usuario REALMENTE tem
 * inscricao (pendente ou paga), com progresso real vindo do Firestore.
 */

interface CardData {
  championship: Championship;
  registration: ChampionshipRegistration;
  progress: UserChampionshipProgress | null;
}

export const MyChampionships: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<CardData[]>([]);
  const historyList = championshipService.getHistoryResults();

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let ativo = true;
    (async () => {
      const [championships, registrations] = await Promise.all([
        championshipService.getChampionships(),
        championshipService.getUserRegistrations(),
      ]);
      const minhas = registrations.filter((r) => r.status === 'ACTIVE' || r.status === 'PENDING_PAYMENT');
      const resultado: CardData[] = [];
      for (const reg of minhas) {
        const champ = championships.find((c) => c.id === reg.championshipId);
        if (!champ) continue;
        const progress = reg.status === 'ACTIVE' ? await championshipService.getUserProgress(champ.id) : null;
        resultado.push({ championship: champ, registration: reg, progress });
      }
      if (ativo) { setCards(resultado); setLoading(false); }
    })();
    return () => { ativo = false; };
  }, [user]);

  return (
    <div className="w-full min-h-screen bg-transparent text-white pb-28 pt-3 px-3.5 sm:px-5 max-w-md mx-auto select-none">
      {/* Top Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/championships')}
          className="w-9 h-9 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer"
          aria-label="Voltar para Campeonatos"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold tracking-wider font-bebas text-white uppercase m-0 leading-tight">
            MEUS CAMPEONATOS
          </h1>
        </div>
      </div>

      {/* Tabs: ATIVOS / HISTÓRICO */}
      <div className="flex items-center border-b border-zinc-800 mb-5">
        <button
          onClick={() => setActiveTab('active')}
          className={`flex-1 py-2 text-center font-bebas text-[14px] tracking-wider transition-colors cursor-pointer ${
            activeTab === 'active'
              ? 'text-[#ffb000] border-b-2 border-[#ffb000] font-bold'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          ATIVOS
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2 text-center font-bebas text-[14px] tracking-wider transition-colors cursor-pointer ${
            activeTab === 'history'
              ? 'text-[#ffb000] border-b-2 border-[#ffb000] font-bold'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          HISTÓRICO
        </button>
      </div>

      {activeTab === 'active' && (
        <div className="space-y-4">
          {loading && (
            <div className="text-center text-zinc-500 text-[12px] font-sans py-10">Carregando...</div>
          )}

          {!loading && cards.length === 0 && (
            <div className="rounded-[18px] bg-[#121113]/90 border border-zinc-800/80 p-6 text-center space-y-3">
              <Trophy size={28} className="mx-auto text-zinc-600" />
              <p className="text-[12px] text-zinc-400 font-sans">
                Você ainda não está inscrito em nenhum campeonato.
              </p>
              <button
                onClick={() => navigate('/championships')}
                className="px-4 py-2 rounded-lg bg-amber-500 text-black font-bebas text-[13px] font-bold tracking-wide"
              >
                VER CAMPEONATOS
              </button>
            </div>
          )}

          {cards.map(({ championship: champ, registration: reg, progress }) => {
            const isGold = champ.accentColor === 'gold';
            const isActive = reg.status === 'ACTIVE';
            return (
              <div
                key={champ.id}
                className={`relative overflow-hidden rounded-[22px] bg-[#121113]/90 backdrop-blur-md border p-4 shadow-xl ${
                  isGold ? 'border-amber-500/30' : 'border-teal-500/30'
                }`}
              >
                <div className="flex items-start justify-between relative z-10">
                  <div className="space-y-1 max-w-[62%]">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                        isGold ? 'bg-amber-950/60 border-amber-500/40 text-amber-400' : 'bg-teal-950/60 border-teal-500/40 text-teal-400'
                      }`}>
                        {isGold ? <Dumbbell size={15} /> : <Activity size={15} />}
                      </div>
                      <div>
                        <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-400 block leading-none">
                          INVICTUS
                        </span>
                        <h2 className="text-[17px] font-extrabold font-bebas text-white uppercase leading-none mt-0.5">
                          {champ.title.replace('INVICTUS ', '')}
                        </h2>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ml-1 ${
                        isActive
                          ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                          : 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
                      }`}>
                        {isActive ? 'Ativo' : 'Pagamento pendente'}
                      </span>
                    </div>

                    {isActive && progress && (
                      <div className="grid grid-cols-3 gap-1 pt-3 text-center">
                        <div className="bg-zinc-950/60 p-1.5 rounded-lg border border-zinc-800/80">
                          <span className="text-[14px] font-extrabold font-bebas text-white block leading-none">
                            {progress.daysRemaining}
                          </span>
                          <span className="text-[8px] text-zinc-400 uppercase tracking-tight block mt-0.5">dias restantes</span>
                        </div>
                        <div className="bg-zinc-950/60 p-1.5 rounded-lg border border-zinc-800/80">
                          <span className="text-[14px] font-extrabold font-bebas text-amber-400 block leading-none">
                            {progress.currentRank}º
                          </span>
                          <span className="text-[8px] text-zinc-400 uppercase tracking-tight block mt-0.5">Sua posição</span>
                        </div>
                        <div className="bg-zinc-950/60 p-1.5 rounded-lg border border-zinc-800/80">
                          <span className="text-[14px] font-extrabold font-bebas text-amber-400 block leading-none">
                            {progress.totalScore.toLocaleString('pt-BR')}
                          </span>
                          <span className="text-[8px] text-zinc-400 uppercase tracking-tight block mt-0.5">Pontos</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="w-24 h-24 sm:w-28 sm:h-28 -mt-2 -mr-2 shrink-0">
                    <AthleteIllustration type={isGold ? 'arena' : 'run_elite'} className="w-full h-full" />
                  </div>
                </div>

                <button
                  onClick={() => isActive ? navigate(`/championships/my/${champ.id}`) : navigate(`/championships/${champ.id}/checkout-redirect`)}
                  className={`w-full mt-3.5 py-2.5 rounded-xl font-bebas text-[14px] font-bold tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-[0.98] transition-all cursor-pointer ${
                    isGold ? 'bg-[#ffb000] text-black hover:bg-amber-400' : 'bg-[#14b8a6] text-black hover:bg-teal-400'
                  }`}
                >
                  <span>{isActive ? 'VER DETALHES' : 'FINALIZAR PAGAMENTO'}</span>
                  <ChevronRight size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          {historyList.length === 0 && (
            <div className="text-center text-zinc-500 text-[12px] font-sans py-10">
              Nenhum campeonato finalizado ainda.
            </div>
          )}
          {historyList.map((item) => {
            const isArena = item.championshipId.includes('arena');
            return (
              <div
                key={item.championshipId}
                className="rounded-[20px] bg-[#121113] border border-zinc-800/80 p-4 shadow-lg flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                    isArena ? 'bg-amber-950/60 border-amber-500/40 text-amber-400' : 'bg-teal-950/60 border-teal-500/40 text-teal-400'
                  }`}>
                    {isArena ? <Dumbbell size={18} /> : <Activity size={18} />}
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold font-sans text-white">{item.championshipTitle}</h3>
                    <span className="text-[10px] text-zinc-400 font-sans block">{item.edition}</span>
                    <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-500 block mt-0.5">Finalizado</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-zinc-400 font-sans block">Sua colocação</span>
                  <span className={`text-[18px] font-extrabold font-bebas ${item.finalRank <= 5 ? 'text-[#ffb000]' : 'text-zinc-300'}`}>
                    {item.finalRank}º <span className="text-[12px] font-sans">lugar</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
