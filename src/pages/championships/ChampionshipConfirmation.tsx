import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, Dumbbell, Activity } from 'lucide-react';
import { championshipService } from '../../services/championshipService';

export const ChampionshipConfirmation: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const champ = championshipService.getChampionshipById(id || 'invictus_arena_30d');

  const isGold = champ?.accentColor === 'gold';
  const themeColor = isGold ? '#ffb000' : '#14b8a6';

  return (
    <div className="w-full min-h-screen bg-transparent text-white pb-28 pt-3 px-3.5 sm:px-5 max-w-md mx-auto select-none flex flex-col justify-between">
      <div>
        {/* Top Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/profile')}
            className="w-9 h-9 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer"
            aria-label="Voltar para Perfil"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-wider font-bebas text-white uppercase m-0 leading-tight">
              INSCRIÇÃO CONFIRMADA
            </h1>
          </div>
        </div>

        {/* Success Icon with Home Trophy */}
        <div className="flex flex-col items-center justify-center py-4 text-center space-y-2.5">
          <div className="w-20 h-24 flex items-center justify-center relative">
            <div className="absolute w-20 h-20 rounded-full bg-amber-500/20 blur-xl pointer-events-none" />
            <img
              src="/trofeu.webp"
              alt="Troféu Oficial Invictus"
              className="w-16 h-20 object-contain drop-shadow-[0_0_18px_rgba(245,158,11,0.6)] select-none pointer-events-none relative z-10"
            />
          </div>

          <h2 className="text-[19px] font-bold font-sans text-white pt-1">
            Você está oficialmente na disputa!
          </h2>

          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900/90 border border-amber-500/30">
            {isGold ? <Dumbbell size={14} className="text-amber-400" /> : <Activity size={14} className="text-teal-400" />}
            <span className="text-[12px] font-bold font-bebas tracking-wide text-white uppercase">
              {champ?.title || 'Invictus Arena 30D'}
            </span>
          </div>
        </div>

        {/* Card: DETALHES DA INSCRIÇÃO */}
        <div className="rounded-[20px] bg-[#121113]/90 backdrop-blur-md border border-zinc-800/80 p-4 mb-6 shadow-xl space-y-3 font-sans">
          <span className="text-[11px] font-bold uppercase tracking-wider font-bebas text-zinc-400 block pb-1 border-b border-zinc-800/60">
            DETALHES DA INSCRIÇÃO
          </span>

          <div className="flex items-center justify-between text-[12px]">
            <span className="text-zinc-400">Campeonato</span>
            <span className="font-bold text-white">{champ?.title || 'Invictus Arena 30D'}</span>
          </div>

          <div className="flex items-center justify-between text-[12px]">
            <span className="text-zinc-400">Período</span>
            <span className="font-bold text-white">01/07 a 30/07</span>
          </div>

          <div className="flex items-center justify-between text-[12px]">
            <span className="text-zinc-400">Premiação</span>
            <span className="font-bold text-amber-400">Top 5 (A ser anunciada)</span>
          </div>

          <div className="flex items-center justify-between text-[12px]">
            <span className="text-zinc-400">Status</span>
            <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
              Ativo
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Action Buttons */}
      <div className="space-y-2.5">
        <button
          onClick={() => navigate(`/championships/my/${champ?.id || 'invictus_arena_30d'}`)}
          className="w-full py-3.5 rounded-xl font-bebas text-[16px] font-bold tracking-wider bg-[#ffb000] text-black hover:bg-amber-400 active:scale-[0.98] shadow-lg transition-all cursor-pointer"
        >
          VER MEU CAMPEONATO
        </button>

        <button
          onClick={() => navigate('/profile')}
          className="w-full py-2.5 rounded-xl bg-transparent border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white font-bebas text-[14px] font-bold tracking-wider transition-colors cursor-pointer"
        >
          IR PARA O PERFIL
        </button>
      </div>
    </div>
  );
};
