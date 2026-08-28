import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, Copy, Check, ShieldCheck, RefreshCw, Trophy } from 'lucide-react';
import { seasonInscriptionService, QrCodePix, SeasonInscriptionStatus } from '../services/seasonInscriptionService';

/**
 * #109/#110: tela de inscricao paga na temporada da Liga Invictus.
 *
 * Ate 2026-08 o backend de cobranca PIX (api/_handlers/season-inscription.ts)
 * existia sem NENHUMA tela que o chamasse -- inscricao so era possivel
 * editando o Firestore na mao. Esta tela mostra o valor/estado atual da
 * inscricao, emite a cobranca PIX real via Asaas e faz polling silencioso ate
 * o webhook confirmar o pagamento -- mesmo padrao ja usado em
 * ChampionshipCheckoutAsaas.tsx.
 *
 * A inscricao aqui NAO exige selfie de presenca antes de cobrar (diferente de
 * Campeonatos) porque o backend (inscricao-service.ts::criarInscricao) nao
 * implementa esse gate -- reflete exatamente o contrato do servidor, sem
 * inventar um passo extra que ele nao suporta.
 */
export function SeasonInscription() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SeasonInscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<QrCodePix | null>(null);
  const [valorCobrado, setValorCobrado] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const carregarStatus = async () => {
    try {
      const dados = await seasonInscriptionService.getStatus();
      setStatus(dados);
      return dados;
    } catch (err: any) {
      setErro(err?.message || 'Falha ao carregar a inscrição.');
      return null;
    }
  };

  useEffect(() => {
    let ativo = true;
    setLoading(true);
    carregarStatus().finally(() => { if (ativo) setLoading(false); });
    return () => { ativo = false; };
  }, []);

  // Poll discreto enquanto ha um QR pendente exibido: assim que o webhook do
  // Asaas confirmar, minhaInscricao.status vira 'paga' e a tela atualiza
  // sozinha, sem botao manual de "ja paguei".
  useEffect(() => {
    if (!qrCode) return;
    const interval = setInterval(async () => {
      const dados = await carregarStatus();
      if (dados?.minhaInscricao?.status === 'paga') {
        setQrCode(null);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [qrCode]);

  const handleInscrever = async () => {
    setErro(null);
    setCriando(true);
    try {
      const resultado = await seasonInscriptionService.criarInscricao();
      setQrCode(resultado.qrCode);
      setValorCobrado(resultado.valor);
    } catch (err: any) {
      setErro(err?.message || 'Não foi possível gerar a cobrança da inscrição.');
    } finally {
      setCriando(false);
    }
  };

  const handleCopyPix = () => {
    if (!qrCode) return;
    navigator.clipboard.writeText(qrCode.payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const jaPago = status?.minhaInscricao?.status === 'paga';
  const valorExibido = valorCobrado ?? status?.valor ?? null;

  return (
    <div className="w-full min-h-screen bg-[#07090e] text-white pb-20 max-w-md mx-auto select-none flex flex-col justify-between">
      <div>
        <div className="bg-[#0f1422] border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between text-zinc-400 text-[11px] font-sans">
          <button onClick={() => navigate('/league')} className="text-zinc-400 hover:text-white flex items-center gap-1" aria-label="Voltar">
            <ArrowLeft size={14} />
          </button>
          <div className="flex items-center gap-1.5 bg-[#07090e] px-3 py-1 rounded-full border border-zinc-800 text-zinc-300">
            <Lock size={11} className="text-emerald-400" />
            <span className="font-mono text-[10px]">checkout.asaas.com</span>
          </div>
          <div className="w-4" />
        </div>

        <div className="p-5 text-center border-b border-zinc-800/80 bg-gradient-to-b from-[#0e172e] to-[#07090e]">
          <div className="inline-flex items-center justify-center mb-3">
            <span className="text-[26px] font-black tracking-tight text-[#004bf7] font-sans">
              as<span className="text-[#00c0f3]">aas</span>
            </span>
          </div>

          <h1 className="text-[17px] font-bold font-sans text-white flex items-center justify-center gap-1.5">
            <Trophy size={16} className="text-[#ffb400]" /> Inscrição na Temporada
          </h1>
          <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
            Liga Invictus{status ? ` · ${status.seasonId.replace('season_', '')}` : ''}
          </p>

          {valorExibido !== null && (
            <div className="text-[24px] font-extrabold font-bebas tracking-wide text-white mt-2">
              R$ {valorExibido.toFixed(2).replace('.', ',')}
            </div>
          )}
        </div>

        <div className="px-5 pt-4">
          {erro && (
            <div className="p-3 mb-4 rounded-xl bg-red-950/80 border border-red-500/50 text-red-300 text-[11px] font-sans">
              {erro}
            </div>
          )}

          {loading ? (
            <div className="bg-[#121624] border border-zinc-800 rounded-2xl p-8 text-center space-y-3 shadow-xl">
              <RefreshCw size={22} className="animate-spin mx-auto text-zinc-500" />
              <p className="text-[12px] text-zinc-400 font-sans">Carregando...</p>
            </div>
          ) : jaPago ? (
            <div className="bg-[#121624] border border-emerald-700/50 rounded-2xl p-6 text-center space-y-3 shadow-xl">
              <Check size={28} className="mx-auto text-emerald-400" />
              <p className="text-[13px] text-white font-sans font-bold">Inscrição confirmada!</p>
              <p className="text-[11px] text-zinc-400 font-sans">Você está competindo nesta temporada da Liga Invictus.</p>
              <button onClick={() => navigate('/league')} className="w-full py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-[12px] font-bold font-sans">
                Voltar para a Liga
              </button>
            </div>
          ) : qrCode ? (
            <div className="bg-[#121624] border border-zinc-800 rounded-2xl p-5 text-center space-y-4 shadow-xl">
              <div className="w-48 h-48 mx-auto bg-white rounded-xl p-3 flex flex-col items-center justify-center shadow-lg overflow-hidden">
                <img
                  src={`data:image/png;base64,${qrCode.encodedImage}`}
                  alt="QR Code PIX"
                  className="w-full h-full object-contain"
                />
              </div>

              <button
                onClick={handleCopyPix}
                className="w-full py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-[12px] font-bold font-sans flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                <span>{copied ? 'Código Pix Copiado!' : 'Copiar código Pix'}</span>
              </button>

              <p className="text-[11px] text-zinc-400 font-sans flex items-center justify-center gap-1.5">
                <RefreshCw size={11} className="animate-spin" />
                Assim que o Pix for pago, a confirmação é automática.
              </p>
            </div>
          ) : status && !status.inscricoesAbertas ? (
            <div className="bg-[#121624] border border-zinc-800 rounded-2xl p-6 text-center space-y-2 shadow-xl">
              <p className="text-[13px] text-white font-sans font-bold">Inscrições fechadas no momento</p>
              <p className="text-[11px] text-zinc-400 font-sans">Volte mais tarde para se inscrever na próxima temporada.</p>
            </div>
          ) : (
            <div className="bg-[#121624] border border-zinc-800 rounded-2xl p-6 text-center space-y-3 shadow-xl">
              <p className="text-[11px] text-zinc-400 font-sans">
                A disputa acontece dentro da sua academia. O pote é formado pelas inscrições dos alunos dela.
              </p>
              <button
                onClick={handleInscrever}
                disabled={criando}
                className="w-full py-3 rounded-xl bg-[#ffb400] hover:bg-[#e0a000] disabled:opacity-60 text-black text-[13px] font-extrabold font-sans transition-colors"
              >
                {criando ? 'Gerando cobrança...' : 'Inscrever-se agora'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-5 space-y-3 bg-[#07090e] border-t border-zinc-800/80">
        <div className="flex items-center justify-center gap-1.5 text-emerald-400 text-[11px] font-sans">
          <ShieldCheck size={14} />
          <span>Asaas · Ambiente 100% seguro</span>
        </div>
      </div>
    </div>
  );
}
