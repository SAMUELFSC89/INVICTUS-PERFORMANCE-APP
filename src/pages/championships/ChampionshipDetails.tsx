import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Share2, Dumbbell, Activity, Trophy, FileText, Users, Clock } from 'lucide-react';
import { championshipService } from '../../services/championshipService';
import { Championship } from '../../types/championships';
import { AthleteIllustration } from './AthleteIllustration';

function calcularTempoRestante(endAt: string) {
  const diffMs = Math.max(0, new Date(endAt).getTime() - Date.now());
  const totalSeconds = Math.floor(diffMs / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export const ChampionshipDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [champ, setChamp] = useState<Championship | undefined | null>(null);

  useEffect(() => {
    let ativo = true;
    championshipService.getChampionshipById(id || 'invictus_arena_30d').then((c) => {
      if (ativo) setChamp(c || undefined);
    });
    return () => { ativo = false; };
  }, [id]);

  // Countdown real ate o encerramento oficial do campeonato (champ.endAt) --
  // ate 2026-08 era decorativo (comecava sempre em "24d 8h 37m 12s" e so
  // descontava, sem nenhuma relacao com a data real da competicao).
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    if (!champ) return;
    setTimeLeft(calcularTempoRestante(champ.endAt));
    const timer = setInterval(() => setTimeLeft(calcularTempoRestante(champ.endAt)), 1000);
    return () => clearInterval(timer);
  }, [champ]);

  if (champ === null) {
    return <div className="w-full min-h-screen bg-transparent" />;
  }

  if (!champ) {
    return (
      <div className="w-full min-h-screen bg-transparent text-white p-6 flex flex-col items-center justify-center">
        <p className="text-zinc-400">Campeonato não encontrado.</p>
        <button onClick={() => navigate('/championships')} className="mt-4 px-4 py-2 bg-amber-500 text-black font-bold rounded-lg">
          Voltar para Campeonatos
        </button>
      </div>
    );
  }

  const isGold = champ.accentColor === 'gold';
  const themeColor = isGold ? '#ffb000' : '#14b8a6';
  const btnBg = isGold ? 'bg-[#ffb000] text-black hover:bg-amber-400' : 'bg-[#14b8a6] text-black hover:bg-teal-400';

  return (
    <div className="w-full min-h-screen bg-transparent text-white pb-28 pt-3 px-3.5 sm:px-5 max-w-md mx-auto select-none">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate('/championships')}
          className="w-9 h-9 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer"
          aria-label="Voltar"
        >
          <ChevronLeft size={20} />
        </button>

        <button
          onClick={() => {
            if (navigator.share) {
              navigator.share({
                title: champ.title,
                text: `${champ.title} - ${champ.subtitle} no Invictus!`,
                url: window.location.href
              }).catch(() => {});
            }
          }}
          className="w-9 h-9 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer"
          aria-label="Compartilhar"
        >
          <Share2 size={17} />
        </button>
      </div>

      {/* Hero Header Card */}
      {champ.id === 'invictus_arena_30d' ? (
        <div className="space-y-3 mb-4">
          {/* Official Responsive Visual Banner Container */}
          <div className="relative w-full aspect-[16/9.2] rounded-[22px] overflow-hidden bg-black/80 border border-amber-500/40 shadow-2xl">
            <img
              src="/assets/championships/arena_30d_banner.webp"
              alt="INVICTUS ARENA 30D"
              className="w-full h-full object-cover object-center"
              referrerPolicy="no-referrer"
            />
            {/* Top Overlay Badges */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10 pointer-events-none">
              <span className="text-[9.5px] font-bold px-2.5 py-1 rounded-lg bg-black/80 backdrop-blur-md border border-amber-500/40 text-amber-300 uppercase tracking-wider">
                {champ.durationDays} DIAS
              </span>
              <span className="text-[9.5px] font-bold px-2.5 py-1 rounded-lg bg-amber-500/20 backdrop-blur-md border border-amber-500/40 text-amber-300 uppercase tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                LANÇAMENTO EM BREVE
              </span>
            </div>
          </div>
        </div>
      ) : champ.id === 'invictus_run_elite_30d' ? (
        <div className="space-y-3 mb-4">
          {/* Official Responsive Visual Banner Container */}
          <div className="relative w-full aspect-[16/9.2] rounded-[22px] overflow-hidden bg-black/80 border border-teal-500/40 shadow-2xl">
            <img
              src="/assets/championships/run_elite_30d_banner.webp"
              alt="INVICTUS RUN ELITE 30D"
              className="w-full h-full object-cover object-center"
              referrerPolicy="no-referrer"
            />
            {/* Top Overlay Badges */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10 pointer-events-none">
              <span className="text-[9.5px] font-bold px-2.5 py-1 rounded-lg bg-black/80 backdrop-blur-md border border-teal-500/40 text-teal-300 uppercase tracking-wider">
                {champ.durationDays} DIAS
              </span>
              <span className="text-[9.5px] font-bold px-2.5 py-1 rounded-lg bg-teal-500/20 backdrop-blur-md border border-teal-500/40 text-teal-300 uppercase tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                LANÇAMENTO EM BREVE
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* DEFAULT HERO */
        <div className="relative overflow-hidden rounded-[24px] bg-[#121113]/90 backdrop-blur-md border border-zinc-800/80 p-4 mb-4 shadow-xl">
          <div className="flex items-start justify-between relative z-10">
            <div className="space-y-1.5 max-w-[62%]">
              {/* Logo Badge */}
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                    isGold
                      ? 'bg-amber-950/60 border-amber-500/40 text-[#ffb000]'
                      : 'bg-teal-950/60 border-teal-500/40 text-[#14b8a6]'
                  }`}
                >
                  {isGold ? <Dumbbell size={16} /> : <Activity size={16} />}
                </div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 block">
                  INVICTUS
                </span>
              </div>

              <h1 className="text-[22px] font-extrabold tracking-wide font-bebas text-white uppercase leading-none mt-1">
                {champ.title.replace('INVICTUS ', '')}
              </h1>
              <p className="text-[11px] text-zinc-400 font-sans font-medium">{champ.subtitle}</p>
              <p className="text-[11.5px] text-zinc-300 font-sans leading-relaxed pt-1">
                {champ.description}
              </p>

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2">
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 uppercase tracking-wider">
                  {champ.durationDays} DIAS
                </span>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  INSCRIÇÕES ABERTAS
                </span>
              </div>
            </div>

            {/* Athlete Render */}
            <div className="w-28 h-28 sm:w-32 sm:h-32 -mt-1 -mr-2 shrink-0">
              <AthleteIllustration type={isGold ? 'arena' : 'run_elite'} className="w-full h-full" />
            </div>
          </div>
        </div>
      )}

      {/* Card: SOBRE O CAMPEONATO */}
      <div className="rounded-[18px] bg-[#121113]/90 backdrop-blur-md border border-zinc-800/80 p-3.5 mb-4 shadow-md">
        <span className="text-[11px] font-bold uppercase tracking-wider font-bebas text-zinc-400 block mb-1">
          SOBRE O CAMPEONATO
        </span>
        <p className="text-[11.5px] text-zinc-300 font-sans leading-relaxed">
          Participe durante {champ.durationDays} dias, registre seus treinos homologados de{' '}
          {isGold ? 'musculação' : 'corrida outdoor'} e dispute o Top 5 com atletas de todo o Brasil.
        </p>
      </div>

      {/* Card: PREMIAÇÃO TOP 5 */}
      <div className="relative overflow-hidden rounded-[20px] bg-[#121113]/90 backdrop-blur-md border border-amber-500/30 p-4 mb-4 shadow-xl">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[12px] font-bold uppercase tracking-wider font-bebas text-[#ffb000] flex items-center gap-1.5">
            <img src="/trofeu.webp" alt="Troféu" className="w-4 h-5 object-contain" />
            PREMIAÇÃO TOP 5
          </span>
          <span className="text-[10px] text-zinc-400 font-sans">
            Status: <strong className="text-amber-400">Em breve</strong>
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1.5 w-full max-w-[65%]">
            {champ.prizeDistribution.map((prize) => (
              <div key={prize.rank} className="flex items-center justify-between text-[11.5px] font-sans">
                <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                  <span
                    className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${
                      prize.rank === 1
                        ? 'bg-amber-400 text-black'
                        : prize.rank === 2
                        ? 'bg-zinc-300 text-black'
                        : prize.rank === 3
                        ? 'bg-amber-700 text-white'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {prize.rank}
                  </span>
                  {prize.label}
                </span>
                <span className="font-semibold text-zinc-400 text-[10.5px]">
                  Em breve
                </span>
              </div>
            ))}
          </div>

          {/* Golden Trophy Graphic from Home Screen */}
          <div className="w-20 h-24 flex items-center justify-center shrink-0">
            <img
              src="/trofeu.webp"
              alt="Troféu Oficial Invictus"
              className="w-16 h-20 object-contain drop-shadow-[0_0_18px_rgba(245,158,11,0.5)] select-none pointer-events-none"
            />
          </div>
        </div>

        <p className="text-[10px] text-zinc-400 font-sans mt-2.5 pt-2 border-t border-zinc-800/60 leading-tight">
          * A premiação oficial em dinheiro será homologada e divulgada com o fechamento das inscrições.
        </p>
      </div>

      {/* Card: TERMINA EM (Countdown) */}
      <div className="rounded-[18px] bg-[#121113]/90 backdrop-blur-md border border-zinc-800/80 p-3.5 mb-5 shadow-md text-center">
        <span className="text-[11px] font-bold uppercase tracking-wider font-bebas text-zinc-400 block mb-2">
          TERMINA EM
        </span>
        <div className="grid grid-cols-4 gap-2 max-w-[280px] mx-auto">
          {[
            { val: timeLeft.days.toString().padStart(2, '0'), label: 'DIAS' },
            { val: timeLeft.hours.toString().padStart(2, '0'), label: 'HORAS' },
            { val: timeLeft.minutes.toString().padStart(2, '0'), label: 'MIN' },
            { val: timeLeft.seconds.toString().padStart(2, '0'), label: 'SEG' }
          ].map((item, idx) => (
            <div key={idx} className="bg-zinc-950/80 border border-zinc-800 rounded-xl py-2 px-1">
              <span className="text-[17px] font-extrabold font-bebas text-white block leading-none">
                {item.val}
              </span>
              <span className="text-[8px] font-bold text-zinc-400 tracking-wider block mt-1">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Action CTA Buttons */}
      <div className="space-y-2.5">
        <button
          onClick={() => navigate(`/championships/${champ.id}/rules`)}
          className={`w-full py-3.5 rounded-xl font-bebas text-[16px] font-bold tracking-wider shadow-lg active:scale-[0.98] transition-all cursor-pointer ${btnBg}`}
        >
          QUERO PARTICIPAR
        </button>

        <button
          onClick={() => navigate(`/championships/${champ.id}/rules`)}
          className="w-full py-2.5 rounded-xl bg-transparent border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white font-sans text-[12px] font-bold tracking-wide flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <FileText size={14} className={isGold ? 'text-amber-400' : 'text-teal-400'} />
          <span>VER REGULAMENTO</span>
        </button>
      </div>
    </div>
  );
};
