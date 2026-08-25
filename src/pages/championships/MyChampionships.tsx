import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Dumbbell, Activity, Trophy, Clock, Award, ShieldCheck } from 'lucide-react';
import { championshipService } from '../../services/championshipService';
import { useUser } from '../../UserContext';
import { AthleteIllustration } from './AthleteIllustration';

export const MyChampionships: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

  const championships = championshipService.getChampionships();
  const historyList = championshipService.getHistoryResults();
  const arenaProgress = championshipService.getUserProgress('invictus_arena_30d', user?.uid || '');

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

      {/* TAB CONTENT: ATIVOS (Tela 7) */}
      {activeTab === 'active' && (
        <div className="space-y-4">
          {/* Card 1: Invictus Arena 30D (Ativo) */}
          <div className="relative overflow-hidden rounded-[22px] bg-[#121113]/90 backdrop-blur-md border border-amber-500/30 p-4 shadow-xl">
            <div className="flex items-start justify-between relative z-10">
              <div className="space-y-1 max-w-[62%]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-400 flex items-center justify-center">
                    <Dumbbell size={15} />
                  </div>
                  <div>
                    <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-400 block leading-none">
                      INVICTUS
                    </span>
                    <h2 className="text-[17px] font-extrabold font-bebas text-white uppercase leading-none mt-0.5">
                      ARENA 30D
                    </h2>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[9px] font-bold uppercase tracking-wider ml-1">
                    Ativo
                  </span>
                </div>

                {/* 3 Stats Columns */}
                <div className="grid grid-cols-3 gap-1 pt-3 text-center">
                  <div className="bg-zinc-950/60 p-1.5 rounded-lg border border-zinc-800/80">
                    <span className="text-[14px] font-extrabold font-bebas text-white block leading-none">
                      {arenaProgress.daysRemaining}
                    </span>
                    <span className="text-[8px] text-zinc-400 uppercase tracking-tight block mt-0.5">
                      dias restantes
                    </span>
                  </div>

                  <div className="bg-zinc-950/60 p-1.5 rounded-lg border border-zinc-800/80">
                    <span className="text-[14px] font-extrabold font-bebas text-amber-400 block leading-none">
                      {arenaProgress.currentRank}º
                    </span>
                    <span className="text-[8px] text-zinc-400 uppercase tracking-tight block mt-0.5">
                      Sua posição
                    </span>
                  </div>

                  <div className="bg-zinc-950/60 p-1.5 rounded-lg border border-zinc-800/80">
                    <span className="text-[14px] font-extrabold font-bebas text-amber-400 block leading-none">
                      {arenaProgress.totalScore.toLocaleString('pt-BR')}
                    </span>
                    <span className="text-[8px] text-zinc-400 uppercase tracking-tight block mt-0.5">
                      Pontos
                    </span>
                  </div>
                </div>
              </div>

              {/* Athlete Render */}
              <div className="w-24 h-24 sm:w-28 sm:h-28 -mt-2 -mr-2 shrink-0">
                <AthleteIllustration type="arena" className="w-full h-full" />
              </div>
            </div>

            {/* CTA Button */}
            <button
              onClick={() => navigate('/championships/my/invictus_arena_30d')}
              className="w-full mt-3.5 py-2.5 rounded-xl bg-[#ffb000] text-black font-bebas text-[14px] font-bold tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-[0.98] transition-all cursor-pointer hover:bg-amber-400"
            >
              <span>VER DETALHES</span>
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Card 2: Invictus Run Elite 30D (Inscrição Realizada) */}
          <div
            onClick={() => navigate('/championships/invictus_run_elite_30d')}
            className="relative overflow-hidden rounded-[22px] bg-[#121113]/90 backdrop-blur-md border border-teal-500/30 p-4 shadow-xl cursor-pointer hover:border-teal-500/60 transition-all"
          >
            <div className="flex items-center justify-between relative z-10">
              <div className="space-y-1 max-w-[65%]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-teal-950/60 border border-teal-500/40 text-teal-400 flex items-center justify-center">
                    <Activity size={15} />
                  </div>
                  <div>
                    <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-400 block leading-none">
                      INVICTUS
                    </span>
                    <h2 className="text-[17px] font-extrabold font-bebas text-white uppercase leading-none mt-0.5">
                      RUN ELITE 30D
                    </h2>
                  </div>
                </div>

                <div className="pt-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider font-bebas text-teal-400 block">
                    INSCRIÇÃO REALIZADA
                  </span>
                  <span className="text-[11px] text-zinc-400 font-sans block mt-0.5">
                    Início em 5 dias
                  </span>
                </div>
              </div>

              {/* Runner Illustration */}
              <div className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 flex items-center justify-end">
                <AthleteIllustration type="run_elite" className="w-full h-full" />
                <ChevronRight size={18} className="text-teal-400 ml-1" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: HISTÓRICO (Tela 9) */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {historyList.map((item) => {
            const isArena = item.championshipId.includes('arena');
            return (
              <div
                key={item.championshipId}
                className="rounded-[20px] bg-[#121113] border border-zinc-800/80 p-4 shadow-lg flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                      isArena
                        ? 'bg-amber-950/60 border-amber-500/40 text-amber-400'
                        : 'bg-teal-950/60 border-teal-500/40 text-teal-400'
                    }`}
                  >
                    {isArena ? <Dumbbell size={18} /> : <Activity size={18} />}
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold font-sans text-white">
                      {item.championshipTitle}
                    </h3>
                    <span className="text-[10px] text-zinc-400 font-sans block">
                      {item.edition}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-500 block mt-0.5">
                      Finalizado
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-zinc-400 font-sans block">
                    Sua colocação
                  </span>
                  <span
                    className={`text-[18px] font-extrabold font-bebas ${
                      item.finalRank <= 5 ? 'text-[#ffb000]' : 'text-zinc-300'
                    }`}
                  >
                    {item.finalRank}º <span className="text-[12px] font-sans">lugar</span>
                  </span>
                </div>
              </div>
            );
          })}

          <button
            onClick={() => alert('Resultados homologados e certificados disponíveis em PDF na Carteira.')}
            className="w-full mt-4 py-3 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-[#121113] text-zinc-300 hover:text-white font-bebas text-[14px] font-bold tracking-wider transition-colors cursor-pointer shadow-md"
          >
            VER TODOS OS RESULTADOS
          </button>
        </div>
      )}
    </div>
  );
};
