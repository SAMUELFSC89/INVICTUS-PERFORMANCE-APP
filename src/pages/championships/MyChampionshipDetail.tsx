import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Dumbbell,
  Activity,
  Trophy,
  FileText,
  HelpCircle,
  Clock,
  Flame,
  CheckCircle2,
  Play,
  Award,
  ShieldCheck,
  ChevronRight
} from 'lucide-react';
import { championshipService } from '../../services/championshipService';
import { useUser } from '../../UserContext';

export const MyChampionshipDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useUser();
  const champ = championshipService.getChampionshipById(id || 'invictus_arena_30d');
  const progress = championshipService.getUserProgress(champ?.id || 'invictus_arena_30d', user?.uid || '');
  const leaderboard = championshipService.getLeaderboard(champ?.id || 'invictus_arena_30d');

  const [activeTab, setActiveTab] = useState<'summary' | 'ranking' | 'activities'>('summary');

  if (!champ) {
    return (
      <div className="w-full min-h-screen bg-transparent text-white p-6 flex flex-col items-center justify-center">
        <p className="text-zinc-400">Campeonato não encontrado.</p>
        <button onClick={() => navigate('/championships/my')} className="mt-4 px-4 py-2 bg-amber-500 text-black font-bold rounded-lg">
          Voltar
        </button>
      </div>
    );
  }

  const isGold = champ.accentColor === 'gold';
  const themeColor = isGold ? '#ffb000' : '#14b8a6';

  const handleStartOfficialAttempt = () => {
    if (champ.type === 'run_elite_corrida') {
      navigate('/running');
    } else {
      navigate('/workout');
    }
  };

  return (
    <div className="w-full min-h-screen bg-transparent text-white pb-28 pt-3 px-3.5 sm:px-5 max-w-md mx-auto select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => navigate('/championships/my')}
            className="w-9 h-9 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer"
            aria-label="Voltar"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-wider font-bebas text-white uppercase m-0 leading-none">
              {champ.title}
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[9px] font-bold uppercase tracking-wider">
              Ativo
            </span>
          </div>
        </div>
      </div>

      {/* Tabs: RESUMO / RANKING / ATIVIDADES */}
      <div className="flex items-center border-b border-zinc-800 mb-5">
        <button
          onClick={() => setActiveTab('summary')}
          className={`flex-1 py-2 text-center font-bebas text-[14px] tracking-wider transition-colors cursor-pointer ${
            activeTab === 'summary'
              ? 'text-[#ffb000] border-b-2 border-[#ffb000] font-bold'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          RESUMO
        </button>
        <button
          onClick={() => setActiveTab('ranking')}
          className={`flex-1 py-2 text-center font-bebas text-[14px] tracking-wider transition-colors cursor-pointer ${
            activeTab === 'ranking'
              ? 'text-[#ffb000] border-b-2 border-[#ffb000] font-bold'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          RANKING
        </button>
        <button
          onClick={() => setActiveTab('activities')}
          className={`flex-1 py-2 text-center font-bebas text-[14px] tracking-wider transition-colors cursor-pointer ${
            activeTab === 'activities'
              ? 'text-[#ffb000] border-b-2 border-[#ffb000] font-bold'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          ATIVIDADES
        </button>
      </div>

      {/* TAB CONTENT: RESUMO (Tela 8) */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          {/* Card: Seu Desempenho */}
          <div className="rounded-[22px] bg-[#121113]/90 backdrop-blur-md border border-amber-500/30 p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-bold uppercase tracking-wider font-bebas text-zinc-300">
                SEU DESEMPENHO
              </span>
              <span className="text-[10px] text-zinc-500 font-sans">{progress.lastUpdated}</span>
            </div>

            {/* 4 Metric Boxes */}
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-zinc-950/70 p-2.5 rounded-xl border border-zinc-800/80">
                <span className="text-[18px] font-extrabold font-bebas text-white block leading-none">
                  {progress.currentRank}º
                </span>
                <span className="text-[9px] text-zinc-400 font-sans block mt-1">Posição</span>
              </div>

              <div className="bg-zinc-950/70 p-2.5 rounded-xl border border-zinc-800/80">
                <span className="text-[18px] font-extrabold font-bebas text-[#ffb000] block leading-none">
                  {progress.totalScore.toLocaleString('pt-BR')}
                </span>
                <span className="text-[9px] text-zinc-400 font-sans block mt-1">Pontos</span>
              </div>

              <div className="bg-zinc-950/70 p-2.5 rounded-xl border border-zinc-800/80">
                <span className="text-[18px] font-extrabold font-bebas text-white block leading-none">
                  {progress.validSessionsCount}
                </span>
                <span className="text-[9px] text-zinc-400 font-sans block mt-1">Treinos</span>
              </div>

              <div className="bg-zinc-950/70 p-2.5 rounded-xl border border-zinc-800/80">
                <span className="text-[18px] font-extrabold font-bebas text-white block leading-none">
                  {Math.round(progress.totalTimeMinutes / 60)}h
                </span>
                <span className="text-[9px] text-zinc-400 font-sans block mt-1">Tempo total</span>
              </div>
            </div>
          </div>

          {/* Card: Progresso da Competição */}
          <div className="rounded-[20px] bg-[#121113]/90 backdrop-blur-md border border-zinc-800/80 p-4 shadow-md">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider font-bebas text-zinc-400">
                PROGRESSO DA COMPETIÇÃO
              </span>
              <span className="text-[10px] text-zinc-400 font-sans">
                Duração: {champ.durationDays} dias oficiais
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-3 rounded-full bg-zinc-950 border border-zinc-800 overflow-hidden relative my-2">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                style={{ width: `${progress.progressPercentage}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-[10px] text-zinc-400 font-sans">
              <span>Início da jornada</span>
              <span className="font-bold text-amber-400">{progress.progressPercentage}% concluído</span>
            </div>
          </div>

          {/* 3 Quick Action Links */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => navigate(`/championships/${champ.id}/rules`)}
              className="p-3 rounded-xl bg-[#121113]/90 backdrop-blur-md border border-zinc-800 hover:border-amber-500/40 text-center flex flex-col items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <FileText size={16} className="text-amber-400" />
              <span className="text-[10px] font-sans font-medium text-zinc-300 leading-tight">
                Regras e regulamento
              </span>
            </button>

            <button
              onClick={() => navigate(`/championships/${champ.id}`)}
              className="p-3 rounded-xl bg-[#121113]/90 backdrop-blur-md border border-zinc-800 hover:border-amber-500/40 text-center flex flex-col items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <img src="/trofeu.webp" alt="Troféu" className="w-4 h-5 object-contain" />
              <span className="text-[10px] font-sans font-medium text-zinc-300 leading-tight">
                Detalhes da premiação
              </span>
            </button>

            <button
              onClick={() => alert('Canal de suporte e homologação: suporte@invictusfit.com')}
              className="p-3 rounded-xl bg-[#121113]/90 backdrop-blur-md border border-zinc-800 hover:border-amber-500/40 text-center flex flex-col items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <HelpCircle size={16} className="text-amber-400" />
              <span className="text-[10px] font-sans font-medium text-zinc-300 leading-tight">
                Suporte e Dúvidas
              </span>
            </button>
          </div>

          {/* Primary CTA: Iniciar Tentativa Oficial */}
          <button
            onClick={handleStartOfficialAttempt}
            className="w-full mt-2 py-3.5 rounded-xl bg-[#ffb000] text-black hover:bg-amber-400 font-bebas text-[16px] font-bold tracking-wider flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all cursor-pointer"
          >
            <Play size={16} className="fill-black" />
            <span>INICIAR TENTATIVA OFICIAL</span>
          </button>
        </div>
      )}

      {/* TAB CONTENT: RANKING */}
      {activeTab === 'ranking' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800 text-[11px] text-zinc-400 font-sans">
            <span>Classificação ao vivo</span>
            <span>Premiação Top 5 homologada</span>
          </div>

          <div className="space-y-2">
            {leaderboard.map((row) => (
              <div
                key={row.rank}
                className={`p-3 rounded-xl border flex items-center justify-between font-sans ${
                  row.isUser
                    ? 'bg-amber-950/30 border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                    : 'bg-[#121113] border-zinc-800/80'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center font-bebas ${
                      row.rank === 1
                        ? 'bg-amber-400 text-black shadow-md'
                        : row.rank === 2
                        ? 'bg-zinc-300 text-black'
                        : row.rank === 3
                        ? 'bg-amber-700 text-white'
                        : row.isUser
                        ? 'bg-amber-500 text-black font-extrabold'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {row.rank}º
                  </div>
                  <div>
                    <span className={`text-[13px] font-bold block ${row.isUser ? 'text-amber-400' : 'text-white'}`}>
                      {row.name}
                    </span>
                    <span className="text-[10px] text-zinc-400 block">{row.gym}</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[14px] font-extrabold font-bebas text-amber-400 block">
                    {row.score.toLocaleString('pt-BR')} pts
                  </span>
                  {row.rank <= 5 && (
                    <span className="text-[9px] text-emerald-400 font-bold block">
                      Na zona de prêmio
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB CONTENT: ATIVIDADES */}
      {activeTab === 'activities' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800 text-[11px] text-zinc-400 font-sans">
            <span>Sessões homologadas</span>
            <span>Auditoria Camada 2</span>
          </div>

          <div className="space-y-2">
            {[
              { title: 'Treino de Peito & Tríceps', date: 'Hoje às 10:30', pts: 650, time: '52 min', gym: 'Invictus Pro HQ', status: 'Homologado' },
              { title: 'Treino de Costas & Bíceps', date: 'Ontem às 18:15', pts: 650, time: '48 min', gym: 'Invictus Pro HQ', status: 'Homologado' },
              { title: 'Treino de Pernas Completo', date: '22/07 às 09:00', pts: 650, time: '60 min', gym: 'Invictus Pro HQ', status: 'Homologado' }
            ].map((act, i) => (
              <div key={i} className="p-3 rounded-xl bg-[#121113] border border-zinc-800/80 flex items-center justify-between font-sans">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 text-amber-400 flex items-center justify-center">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                  </div>
                  <div>
                    <span className="text-[12px] font-bold text-white block">{act.title}</span>
                    <span className="text-[10px] text-zinc-400 block">{act.date} · {act.gym}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[13px] font-bold text-amber-400 font-bebas block">+{act.pts} pts</span>
                  <span className="text-[9px] text-emerald-400 font-bold block">{act.status}</span>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleStartOfficialAttempt}
            className="w-full mt-3 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-amber-500/30 text-amber-400 font-bebas text-[14px] font-bold tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Play size={14} />
            <span>REGISTRAR NOVO TREINO NO CAMPEONATO</span>
          </button>
        </div>
      )}
    </div>
  );
};
