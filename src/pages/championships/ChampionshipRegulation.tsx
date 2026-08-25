import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronDown,
  Dumbbell,
  Activity,
  Trophy,
  Users,
  Clock,
  BarChart2,
  Scale,
  ShieldCheck,
  XCircle,
  CreditCard,
  RotateCcw,
  FileCheck2,
  Check,
  ShieldAlert,
  HelpCircle,
  FileText
} from 'lucide-react';
import { championshipService, getRegulationSections } from '../../services/championshipService';
import { useUser } from '../../UserContext';
import { CHAMPIONSHIP_CONFIG } from '../../config';

export const ChampionshipRegulation: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useUser();
  const champ = championshipService.getChampionshipById(id || 'invictus_arena_30d');

  const [activeTab, setActiveTab] = useState<'rules' | 'prizes'>('rules');
  const [openSectionId, setOpenSectionId] = useState<number | null>(1);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!champ) {
    return (
      <div className="w-full min-h-screen bg-transparent text-white p-6 flex flex-col items-center justify-center">
        <p className="text-zinc-400">Campeonato não encontrado.</p>
        <button onClick={() => navigate('/championships')} className="mt-4 px-4 py-2 bg-amber-500 text-black font-bold rounded-lg">
          Voltar
        </button>
      </div>
    );
  }

  const isGold = champ.accentColor === 'gold';
  const sections = getRegulationSections(champ.id);

  const toggleSection = (sId: number) => {
    setOpenSectionId(prev => (prev === sId ? null : sId));
  };

  const handleContinue = async () => {
    if (!accepted) return;
    if (!user) {
      alert('Faça login para continuar com a inscrição.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      // Server-side audit trail recording
      const response = await fetch('/api/championships/accept-regulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          championshipId: champ.id,
          userId: user.uid,
          regulationVersion: champ.regulationVersion,
          regulationHash: champ.regulationHash,
          locale: navigator.language || 'pt-BR',
          platform: 'web'
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Falha ao registrar aceite do regulamento no servidor.');
      }

      // Store acceptance locally for client flow consistency
      championshipService.createPendingRegistration(champ, user.uid, user.name);

      // Navigate to registration checkout passing audit acceptance ID
      navigate(`/championships/${champ.id}/register?accId=${encodeURIComponent(data.acceptanceId)}`);
    } catch (err: any) {
      console.error('Error recording regulation acceptance:', err);
      setErrorMsg(err.message || 'Não foi possível registrar o aceite. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-transparent text-white pb-28 pt-3 px-3.5 sm:px-5 max-w-md mx-auto select-none">
      {/* Top Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate(`/championships/${champ.id}`)}
          className="w-9 h-9 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer"
          aria-label="Voltar"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold tracking-wider font-bebas text-white uppercase m-0 leading-tight">
            REGULAMENTO OFICIAL
          </h1>
          <p className="text-[11px] text-zinc-400 font-sans tracking-tight">
            Diretrizes, integridade e conformidade desportiva
          </p>
        </div>
      </div>

      {/* Championship Edition Header Banner */}
      <div className="flex items-center gap-3 p-3 rounded-2xl bg-[#121113]/90 backdrop-blur-md border border-amber-500/30 mb-4 shadow-lg">
        <div className="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
          {isGold ? <Dumbbell size={20} /> : <Activity size={20} />}
        </div>
        <div>
          <h2 className="text-[16px] font-extrabold font-bebas text-white uppercase tracking-wide leading-none">
            {champ.title}
          </h2>
          <span className="text-[10px] text-zinc-400 uppercase font-sans tracking-wider block mt-0.5">
            {champ.edition} · VERSÃO {champ.regulationVersion}
          </span>
        </div>
      </div>

      {/* Tab Selectors: REGRAS / PREMIAÇÃO */}
      <div className="flex items-center border-b border-zinc-800 mb-4">
        <button
          onClick={() => setActiveTab('rules')}
          className={`flex-1 py-2 text-center font-bebas text-[14px] tracking-wider transition-colors cursor-pointer ${
            activeTab === 'rules'
              ? 'text-[#ffb000] border-b-2 border-[#ffb000] font-bold'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          REGULAMENTO COMPLETO ({sections.length} SEÇÕES)
        </button>
        <button
          onClick={() => setActiveTab('prizes')}
          className={`flex-1 py-2 text-center font-bebas text-[14px] tracking-wider transition-colors cursor-pointer ${
            activeTab === 'prizes'
              ? 'text-[#ffb000] border-b-2 border-[#ffb000] font-bold'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          PREMIAÇÃO TOP 5
        </button>
      </div>

      {/* Tab Content: REGRAS (Accordion) */}
      {activeTab === 'rules' && (
        <div className="space-y-2 mb-5">
          {sections.map((section) => {
            const isOpen = openSectionId === section.id;
            return (
              <div
                key={section.id}
                className="rounded-xl bg-[#121113]/90 backdrop-blur-md border border-zinc-800/80 overflow-hidden shadow-sm transition-all"
              >
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full p-3.5 flex items-center justify-between text-left hover:bg-zinc-900/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <FileText size={14} className="text-amber-400 shrink-0" />
                    <span className="text-[12.5px] font-bold font-sans text-zinc-200">
                      {section.title}
                    </span>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`text-zinc-500 transition-transform duration-200 shrink-0 ${
                      isOpen ? 'rotate-180 text-amber-400' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-3.5 pb-3.5 pt-1 text-[11.5px] text-zinc-300 font-sans leading-relaxed border-t border-zinc-800/50 whitespace-pre-line">
                    {section.content}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tab Content: PREMIAÇÃO */}
      {activeTab === 'prizes' && (
        <div className="rounded-2xl bg-[#121113]/90 backdrop-blur-md border border-amber-500/30 p-4 mb-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <span className="text-[12px] font-bold font-bebas text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <img src="/trofeu.webp" alt="Troféu" className="w-4 h-5 object-contain" />
              PREMIAÇÃO TOP 5 (50% DA RECEITA LÍQUIDA ELEGÍVEL)
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-950/70 border border-zinc-800 text-[11px] text-zinc-300 font-sans leading-relaxed">
            <span className="font-bold text-amber-400 block mb-1">Definição Oficial de Receita Líquida:</span>
            {CHAMPIONSHIP_CONFIG.NET_ELIGIBLE_REVENUE_DEFINITION}
          </div>

          <div className="space-y-2">
            {champ.prizeDistribution.map((prize) => (
              <div
                key={prize.rank}
                className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/70 border border-zinc-800/70 text-[12px] font-sans"
              >
                <span className="text-zinc-300 font-medium flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-400 text-[10px] font-bold flex items-center justify-center">
                    {prize.rank}º
                  </span>
                  {prize.label}
                </span>
                <span className="font-semibold text-amber-400 text-[12px]">
                  {prize.percentage}% do Pote
                </span>
              </div>
            ))}
          </div>

          <p className="text-[10.5px] text-zinc-400 font-sans leading-tight pt-1">
            * O montante final do Prize Pool é apurado ao término das inscrições e creditado diretamente na Carteira Digital do Atleta após auditoria final de integridade.
          </p>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 mb-4 rounded-xl bg-red-950/80 border border-red-500/50 text-red-300 text-[11px] font-sans">
          {errorMsg}
        </div>
      )}

      {/* Accept Checkbox */}
      <div
        onClick={() => setAccepted(!accepted)}
        className="flex items-start gap-3 p-3.5 rounded-xl bg-[#121113]/90 backdrop-blur-md border border-zinc-800/80 mb-3 cursor-pointer select-none hover:border-amber-500/40 transition-colors"
      >
        <div
          className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-all ${
            accepted
              ? 'bg-[#ffb000] border-[#ffb000] text-black shadow-[0_0_10px_rgba(255,176,0,0.5)]'
              : 'border-zinc-600 bg-zinc-900'
          }`}
        >
          {accepted && <Check size={14} strokeWidth={3} />}
        </div>
        <span className="text-[11.5px] text-zinc-300 font-sans leading-tight">
          Li, compreendi e aceito integralmente todas as 34 cláusulas do Regulamento Oficial deste campeonato ({champ.regulationVersion}).
        </span>
      </div>

      {/* Formal Apple Disclaimer */}
      <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-900 text-[10px] text-zinc-500 font-sans leading-relaxed mb-4">
        <span className="font-bold text-zinc-400 block mb-0.5">Aviso de Conformidade:</span>
        {CHAMPIONSHIP_CONFIG.APPLE_DISCLAIMER}
      </div>

      {/* CTA Button */}
      <button
        onClick={handleContinue}
        disabled={!accepted || submitting}
        className={`w-full py-3.5 rounded-xl font-bebas text-[16px] font-bold tracking-wider shadow-lg transition-all ${
          accepted && !submitting
            ? 'bg-[#ffb000] text-black hover:bg-amber-400 active:scale-[0.98] cursor-pointer'
            : 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60'
        }`}
      >
        {submitting ? 'VALIDANDO ACEITE NO SERVIDOR...' : 'REGISTRAR ACEITE E CONTINUAR'}
      </button>
    </div>
  );
};
