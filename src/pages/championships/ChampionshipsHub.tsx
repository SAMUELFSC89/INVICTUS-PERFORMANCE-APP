import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Trophy, Users, Award, ChevronRight, Dumbbell, Activity } from 'lucide-react';
import { championshipService } from '../../services/championshipService';
import { useUser } from '../../UserContext';
import { AthleteIllustration } from './AthleteIllustration';

export const ChampionshipsHub: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const championships = championshipService.getChampionships();
  const userRegistrations = championshipService.getUserRegistrations(user?.uid);
  const hasActiveRegistrations = userRegistrations.some(r => r.status === 'ACTIVE');

  return (
    <div className="w-full min-h-screen bg-transparent text-white pb-28 pt-3 px-3.5 sm:px-5 max-w-md mx-auto select-none">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate('/')}
          className="w-9 h-9 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer"
          aria-label="Voltar para Início"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold tracking-wider font-bebas text-white uppercase m-0 leading-tight">
            CAMPEONATOS
          </h1>
          <p className="text-[11px] text-zinc-400 font-sans tracking-tight">
            Compita com atletas reais e dispute o Top 5 oficial.
          </p>
        </div>
      </div>

      {/* Section: CAMPEONATOS ATIVOS */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3 px-0.5">
          <span className="text-[12px] font-bold tracking-wider uppercase font-bebas text-[#ffb000]">
            CAMPEONATOS ATIVOS
          </span>
        </div>

        <div className="space-y-4">
          {championships.map((champ) => {
            const isGold = champ.accentColor === 'gold';
            const borderColor = isGold ? 'border-amber-500/30' : 'border-teal-500/30';
            const btnBg = isGold
              ? 'bg-[#ffb000] text-black hover:bg-amber-400'
              : 'bg-[#14b8a6] text-black hover:bg-teal-400';
            const statHighlight = isGold ? 'text-amber-400' : 'text-teal-400';

            return (
              <div
                key={champ.id}
                className={`relative overflow-hidden rounded-[20px] bg-[#121113]/90 backdrop-blur-md border ${borderColor} p-3.5 sm:p-4 shadow-xl transition-all`}
              >
                {/* Background Ambient Glow */}
                <div
                  className={`absolute -top-12 -right-12 w-44 h-44 rounded-full blur-3xl pointer-events-none opacity-20 ${
                    isGold ? 'bg-amber-500' : 'bg-teal-500'
                  }`}
                />

                {/* Card Content */}
                {champ.id === 'invictus_arena_30d' ? (
                  /* ARENA 30D OFFICIAL BANNER PRESENTATION */
                  <div className="space-y-3">
                    {/* Official Responsive Visual Banner Container */}
                    <div
                      onClick={() => navigate(`/championships/${champ.id}`)}
                      className="relative w-full aspect-[16/9.2] rounded-[16px] overflow-hidden bg-black/80 border border-amber-500/40 shadow-inner group cursor-pointer"
                    >
                      <img
                        src="/assets/championships/arena_30d_banner.webp"
                        alt="INVICTUS ARENA 30D"
                        className="w-full h-full object-cover object-center group-hover:scale-[1.02] transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />
                      {/* Top Corner Metadata Badges */}
                      <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10 pointer-events-none">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md border border-amber-500/40 text-amber-300 uppercase tracking-wider">
                          {champ.durationDays} DIAS
                        </span>
                      </div>
                    </div>
                  </div>
                ) : champ.id === 'invictus_run_elite_30d' ? (
                  /* RUN ELITE 30D OFFICIAL BANNER PRESENTATION */
                  <div className="space-y-3">
                    {/* Official Responsive Visual Banner Container */}
                    <div
                      onClick={() => navigate(`/championships/${champ.id}`)}
                      className="relative w-full aspect-[16/9.2] rounded-[16px] overflow-hidden bg-black/80 border border-teal-500/40 shadow-inner group cursor-pointer"
                    >
                      <img
                        src="/assets/championships/run_elite_30d_banner.webp"
                        alt="INVICTUS RUN ELITE 30D"
                        className="w-full h-full object-cover object-center group-hover:scale-[1.02] transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />
                      {/* Top Corner Metadata Badges */}
                      <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10 pointer-events-none">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md border border-teal-500/40 text-teal-300 uppercase tracking-wider">
                          {champ.durationDays} DIAS
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* DEFAULT CARD TOP */
                  <div className="flex items-start justify-between relative z-10">
                    <div className="space-y-1.5 max-w-[62%]">
                      {/* Badge + Subtitle */}
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                            isGold
                              ? 'bg-amber-950/60 border-amber-500/40 text-[#ffb000]'
                              : 'bg-teal-950/60 border-teal-500/40 text-[#14b8a6]'
                          }`}
                        >
                          {isGold ? <Dumbbell size={15} /> : <Activity size={15} />}
                        </div>
                        <div>
                          <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-400 block leading-none">
                            INVICTUS
                          </span>
                          <h2 className="text-[17px] font-extrabold tracking-wide font-bebas text-white leading-none uppercase">
                            {champ.title.replace('INVICTUS ', '')}
                          </h2>
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-400 font-sans leading-tight">
                        {champ.subtitle}
                      </p>

                      {/* Metadata Pills */}
                      <div className="flex items-center gap-1.5 pt-1">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-zinc-900/90 border border-zinc-800 text-zinc-300 uppercase tracking-wider">
                          {champ.durationDays} DIAS
                        </span>
                      </div>
                    </div>

                    {/* Athlete Illustration */}
                    <div className="w-24 h-24 sm:w-28 sm:h-28 -mt-1 -mr-1 shrink-0">
                      <AthleteIllustration type={isGold ? 'arena' : 'run_elite'} className="w-full h-full" />
                    </div>
                  </div>
                )}

                {/* Stats 3-Column Strip */}
                <div className="grid grid-cols-3 gap-1.5 py-2.5 px-2 my-3 rounded-xl bg-zinc-950/70 border border-zinc-800/80 relative z-10 text-center">
                  <div>
                    <div className="flex items-center justify-center gap-1 text-zinc-400 text-[10px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="font-bold text-amber-400 text-[11px]">Em breve</span>
                    </div>
                    <span className="text-[8.5px] uppercase tracking-wider text-zinc-400 block mt-0.5">
                      LANÇAMENTO
                    </span>
                  </div>

                  <div className="border-x border-zinc-800/80">
                    <div className="flex items-center justify-center gap-1 text-zinc-400 text-[10px]">
                      <Award size={11} className={statHighlight} />
                      <span className="font-bold text-white text-[12px]">Top 5</span>
                    </div>
                    <span className="text-[8.5px] uppercase tracking-wider text-zinc-400 block mt-0.5">
                      PREMIADOS
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center justify-center gap-1 text-zinc-400 text-[10px]">
                      <img src="/trofeu.webp" alt="Troféu" className="w-3.5 h-4 object-contain" />
                      <span className={`font-bold text-[11px] ${statHighlight}`}>
                        Em breve
                      </span>
                    </div>
                    <span className="text-[8.5px] uppercase tracking-wider text-zinc-400 block mt-0.5">
                      PREMIAÇÃO
                    </span>
                  </div>
                </div>

                {/* CTA Button */}
                <button
                  onClick={() => navigate(`/championships/${champ.id}`)}
                  className={`w-full py-2.5 rounded-xl font-bebas text-[14px] font-bold tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-[0.98] transition-all cursor-pointer ${btnBg}`}
                >
                  <span>VER DETALHES</span>
                  <ChevronRight size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section: MEUS CAMPEONATOS */}
      <div>
        <div className="flex items-center justify-between mb-2.5 px-0.5">
          <span className="text-[12px] font-bold tracking-wider uppercase font-bebas text-zinc-400">
            MEUS CAMPEONATOS
          </span>
          <button
            onClick={() => navigate('/championships/my')}
            className="text-[11px] text-[#ffb000] hover:underline font-bold font-sans flex items-center gap-0.5 cursor-pointer"
          >
            Ver todos <ChevronRight size={12} />
          </button>
        </div>

        <div className="rounded-[18px] bg-[#121113] border border-zinc-800/80 p-3.5 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-400 shrink-0">
              <Trophy size={18} />
            </div>
            <div>
              <p className="text-[11px] text-zinc-300 font-sans leading-tight">
                {hasActiveRegistrations
                  ? 'Você possui inscrições ativas em andamento.'
                  : 'Você ainda não está inscrito em nenhum campeonato.'}
              </p>
            </div>
          </div>

          <button
            onClick={() => navigate('/championships/my')}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-amber-500/30 text-amber-400 text-[11px] font-bold font-bebas tracking-wide shrink-0 transition-colors cursor-pointer"
          >
            {hasActiveRegistrations ? 'MEUS ATIVOS' : 'VER ATIVOS'}
          </button>
        </div>
      </div>
    </div>
  );
};
