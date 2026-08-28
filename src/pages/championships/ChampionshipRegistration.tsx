import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Check, Lock, Dumbbell, Activity, ShieldCheck, ChevronRight, AlertTriangle } from 'lucide-react';
import { championshipService } from '../../services/championshipService';
import { Championship } from '../../types/championships';
import { useUser } from '../../UserContext';
import { AthleteIllustration } from './AthleteIllustration';
import { CHAMPIONSHIP_CONFIG } from '../../config';
import { Capacitor } from '@capacitor/core';
import { VerifiedPresenceModal } from '../../components/VerifiedPresenceModal';

export const ChampionshipRegistration: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const accId = searchParams.get('accId');
  const navigate = useNavigate();
  const { user } = useUser();
  const [champ, setChamp] = useState<Championship | undefined | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [presenceCheck, setPresenceCheck] = useState<{ presenceCheckId: string; livenessPrompt: string; userMessage: string } | null>(null);

  useEffect(() => {
    let ativo = true;
    championshipService.getChampionshipById(id || 'invictus_arena_30d').then((c) => {
      if (ativo) setChamp(c || undefined);
    });
    return () => { ativo = false; };
  }, [id]);

  if (champ === null) {
    return <div className="w-full min-h-screen bg-transparent" />;
  }

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

  const isAndroidDisabled = Capacitor.getPlatform() === 'android' && !CHAMPIONSHIP_CONFIG.PAID_CHAMPIONSHIPS_ANDROID;
  const isGold = champ.accentColor === 'gold';
  const themeColor = isGold ? '#ffb000' : '#14b8a6';

  const handleProceedToAsaas = async () => {
    if (!user) {
      alert('Faça login para continuar com a inscrição.');
      return;
    }

    if (!accId) {
      alert('É obrigatório aceitar o regulamento antes de prosseguir.');
      navigate(`/championships/${champ.id}/rules`);
      return;
    }

    if (isAndroidDisabled) {
      alert('As inscrições diretas neste dispositivo abrirão em breve.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      // Antes de emitir a cobranca PIX real (dinheiro real em disputa), o
      // servidor exige confirmacao de presenca por selfie -- ver
      // api/_handlers/championships.ts e api/_lib/presence-check-service.ts.
      // O QR code so chega depois, no onSuccess do modal abaixo.
      const resultado = await championshipService.createPayment(champ.id, accId);
      setPresenceCheck({
        presenceCheckId: resultado.presenceCheckId,
        livenessPrompt: resultado.livenessPrompt,
        userMessage: resultado.userMessage,
      });
    } catch (e: any) {
      console.error('Error initiating registration payment', e);
      if (/regulamento/i.test(e.message || '')) {
        navigate(`/championships/${champ.id}/rules`);
        return;
      }
      setErrorMessage(e.message || 'Não foi possível conectar com o gateway de pagamento. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handlePresenceSuccess = (result: { status: string; userMessage: string; commitResult?: any }) => {
    setPresenceCheck(null);

    if (result.status === 'approved' && result.commitResult) {
      // commitResult aqui e o mesmo formato { valor, qrCode, jaExistia } que
      // antes vinha direto de createPayment -- ver actionType
      // 'championship_registration' em api/_handlers/validate-presence.ts.
      navigate(`/championships/${champ!.id}/checkout-redirect`, { state: { pagamento: result.commitResult } });
      return;
    }

    // 'pending' ou qualquer outro caso sem commitResult: inscricao de
    // campeonato so avanca com presenca 'approved' (dinheiro real). Sem
    // aprovacao total, nao ha cobranca -- devolve o atleta pra tela com um aviso.
    setErrorMessage(result.userMessage || 'Não foi possível confirmar sua presença com confiança suficiente para emitir a cobrança. Tente novamente.');
  };

  return (
    <div className="w-full min-h-screen bg-transparent text-white pb-28 pt-3 px-3.5 sm:px-5 max-w-md mx-auto select-none">
      {/* Top Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate(`/championships/${champ.id}/rules`)}
          className="w-9 h-9 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer"
          aria-label="Voltar"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold tracking-wider font-bebas text-white uppercase m-0 leading-tight">
            INSCRIÇÃO OFICIAL
          </h1>
          <p className="text-[11px] text-zinc-400 font-sans tracking-tight">
            Finalize sua vaga na disputa pelo Top 5
          </p>
        </div>
      </div>

      {/* 3-Step Horizontal Indicator */}
      <div className="flex items-center justify-between mb-5 px-2">
        {/* Step 1 */}
        <div className="flex flex-col items-center">
          <div className="w-6 h-6 rounded-full bg-[#ffb000] text-black text-[11px] font-bold flex items-center justify-center">
            <Check size={13} strokeWidth={3} />
          </div>
          <span className="text-[10px] text-zinc-400 font-sans mt-1">Regulamento</span>
        </div>
        <div className="flex-1 h-[2px] bg-[#ffb000] mx-2 -mt-4" />

        {/* Step 2 */}
        <div className="flex flex-col items-center">
          <div className="w-6 h-6 rounded-full bg-[#ffb000] text-black text-[11px] font-bold flex items-center justify-center shadow-[0_0_10px_rgba(255,176,0,0.5)]">
            2
          </div>
          <span className="text-[10px] text-[#ffb000] font-bold font-sans mt-1">Pagamento</span>
        </div>
        <div className="flex-1 h-[2px] bg-zinc-800 mx-2 -mt-4" />

        {/* Step 3 */}
        <div className="flex flex-col items-center">
          <div className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 text-[11px] font-bold flex items-center justify-center">
            3
          </div>
          <span className="text-[10px] text-zinc-500 font-sans mt-1">Confirmação</span>
        </div>
      </div>

      {/* Audit Regulation Acceptance Badge */}
      {accId ? (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-[11px] font-sans mb-4">
          <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
          <span>Regulamento {champ.regulationVersion} aceito com sucesso (ID auditável: {accId.slice(0, 18)}...)</span>
        </div>
      ) : (
        <div className="flex items-center justify-between p-3 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-300 text-[11px] font-sans mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-400 shrink-0" />
            <span>Aceite do regulamento pendente</span>
          </div>
          <button
            onClick={() => navigate(`/championships/${champ.id}/rules`)}
            className="text-[11px] font-bold underline text-amber-300 hover:text-white"
          >
            Ver Regulamento
          </button>
        </div>
      )}

      {/* Mini Banner Header with Home Trophy */}
      <div className="relative overflow-hidden rounded-[20px] bg-[#121113]/90 backdrop-blur-md border border-amber-500/30 p-3.5 mb-4 shadow-lg">
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
              <img src="/trofeu.webp" alt="Troféu Invictus" className="w-7 h-8 object-contain" />
            </div>
            <div>
              <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-400 block leading-none">
                INVICTUS
              </span>
              <h2 className="text-[17px] font-extrabold font-bebas text-white uppercase tracking-wide leading-none mt-0.5">
                {champ.title.replace('INVICTUS ', '')}
              </h2>
              <span className="text-[10px] text-zinc-400 font-sans block">{champ.subtitle}</span>
            </div>
          </div>

          <div className="w-16 h-16 shrink-0">
            <AthleteIllustration type={isGold ? 'arena' : 'run_elite'} className="w-full h-full" />
          </div>
        </div>
      </div>

      {/* Card: RESUMO DA INSCRIÇÃO */}
      <div className="rounded-[18px] bg-[#121113]/90 backdrop-blur-md border border-zinc-800/80 p-4 mb-4 shadow-md space-y-2.5 font-sans">
        <span className="text-[11px] font-bold uppercase tracking-wider font-bebas text-zinc-400 block pb-1 border-b border-zinc-800/60">
          RESUMO DA INSCRIÇÃO
        </span>

        <div className="flex items-center justify-between text-[12px]">
          <span className="text-zinc-400">Campeonato</span>
          <span className="font-bold text-white">{champ.title}</span>
        </div>

        <div className="flex items-center justify-between text-[12px]">
          <span className="text-zinc-400">Período</span>
          <span className="font-bold text-white">{champ.durationDays} dias</span>
        </div>

        <div className="flex items-center justify-between text-[12px]">
          <span className="text-zinc-400">Premiação</span>
          <span className="font-bold text-amber-400 flex items-center gap-1">
            <img src="/trofeu.webp" alt="Troféu" className="w-3.5 h-4 object-contain inline" />
            Top 5 (50% da Receita Líquida)
          </span>
        </div>

        <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between">
          <span className="text-[13px] font-bold text-zinc-300">Valor da inscrição</span>
          <span className="px-3 py-1 rounded-lg bg-[#ffb000] text-black font-bebas text-[15px] font-extrabold shadow-sm">
            R$ {champ.registrationPrice.toFixed(2).replace('.', ',')}
          </span>
        </div>
      </div>

      {/* Section: FORMA DE PAGAMENTO */}
      <div className="space-y-2 mb-4">
        <span className="text-[11px] font-bold uppercase tracking-wider font-bebas text-zinc-400 block px-0.5">
          FORMA DE PAGAMENTO
        </span>
        <p className="text-[11px] text-zinc-400 font-sans px-0.5">
          Você será redirecionado para o ambiente seguro oficial de pagamentos (Asaas).
        </p>

        {/* Asaas Payment Option Card */}
        <div
          onClick={handleProceedToAsaas}
          className="rounded-2xl bg-[#121113]/90 backdrop-blur-md border border-amber-500/40 p-4 flex flex-col items-center justify-center space-y-2 shadow-lg cursor-pointer hover:bg-zinc-900/60 active:scale-[0.99] transition-all"
        >
          {/* Asaas Brand Logo */}
          <div className="flex items-center gap-1.5 py-1">
            <span className="text-[20px] font-extrabold tracking-tight text-[#0030b8] bg-white px-2 py-0.5 rounded-md font-sans">
              as<span className="text-[#00c0f3]">aas</span>
            </span>
          </div>

          <span className="text-[12px] font-bold text-zinc-200 font-sans">
            PIX instantâneo ou Cartão de Crédito
          </span>

          <div className="flex items-center gap-1.5 text-emerald-400 text-[10px] font-sans">
            <Lock size={12} />
            <span>Ambiente 100% seguro homologado</span>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 mb-4 rounded-xl bg-red-950/80 border border-red-500/50 text-red-300 text-[11px] font-sans">
          {errorMessage}
        </div>
      )}

      {/* Apple Formal Disclaimer in Checkout Footer */}
      <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-900 text-[9.5px] text-zinc-500 font-sans leading-relaxed mb-4">
        <span className="font-bold text-zinc-400 block mb-0.5">Conformidade e Isenção:</span>
        {CHAMPIONSHIP_CONFIG.APPLE_DISCLAIMER}
      </div>

      {/* Proceed Button */}
      <button
        onClick={handleProceedToAsaas}
        disabled={loading || !accId}
        className="w-full py-3.5 rounded-xl font-bebas text-[16px] font-bold tracking-wider bg-[#ffb000] text-black hover:bg-amber-400 active:scale-[0.98] shadow-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
      >
        <span>{loading ? 'PROCESSANDO...' : 'PROSSEGUIR PARA PAGAMENTO'}</span>
        <ChevronRight size={16} />
      </button>

      {presenceCheck && (
        <VerifiedPresenceModal
          isOpen={!!presenceCheck}
          presenceCheckId={presenceCheck.presenceCheckId}
          livenessPrompt={presenceCheck.livenessPrompt}
          userMessage={presenceCheck.userMessage}
          onClose={() => setPresenceCheck(null)}
          onSuccess={handlePresenceSuccess}
        />
      )}
    </div>
  );
};
