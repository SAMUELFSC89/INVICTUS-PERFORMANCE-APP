import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Lock, QrCode, Copy, Check, ShieldCheck, ArrowLeft, RefreshCw } from 'lucide-react';
import { championshipService, QrCodePix } from '../../services/championshipService';
import { Championship } from '../../types/championships';
import { useUser } from '../../UserContext';

/**
 * Ate 2026-08 esta tela era 100% decorativa: QR code fixo desenhado em SVG,
 * codigo copia-e-cola hardcoded, e um botao "Simular Pagamento Aprovado" que
 * so chamava o webhook diretamente -- nenhum dinheiro real trafegava, mas a
 * tela parecia uma cobranca real de producao (inclusive alcancavel por
 * usuarios reais via "Meus Campeonatos" -> card fixo -> Inscrever-se).
 *
 * Agora mostra o QR code e o copia-e-cola REAIS devolvidos pelo Asaas (a
 * mesma cobranca criada em ChampionshipRegistration.tsx via
 * championshipService.createPayment). A confirmacao so acontece pelo
 * webhook oficial do Asaas quando o PIX realmente for pago -- por isso esta
 * tela faz polling silencioso do status da inscricao em vez de ter qualquer
 * botao de "aprovar".
 */
export const ChampionshipCheckoutAsaas: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useUser();

  const [champ, setChamp] = useState<Championship | undefined | null>(null);
  const [qrCode, setQrCode] = useState<QrCodePix | null>((location.state as any)?.pagamento?.qrCode || null);
  const [valor, setValor] = useState<number | null>((location.state as any)?.pagamento?.valor || null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    championshipService.getChampionshipById(id || 'invictus_arena_30d').then((c) => {
      if (ativo) setChamp(c || undefined);
    });
    return () => { ativo = false; };
  }, [id]);

  // Sem QR code no state (ex: usuario deu refresh nesta tela): desde que a
  // emissao da cobranca passou a exigir confirmacao de presenca por selfie
  // (ver ChampionshipRegistration.tsx), createPayment() nao devolve mais o QR
  // code direto -- so devolve um novo presenceCheckRequired. Em vez de forcar
  // outra selfie so pra reexibir um QR ja gerado, manda o atleta de volta pra
  // tela de inscricao: se a cobranca ja existe, ele so confirma presenca de
  // novo (o backend e idempotente -- nao gera cobranca duplicada) e volta pra
  // cá com o QR no state.
  useEffect(() => {
    if (qrCode || !champ || !user) return;
    const accId = new URLSearchParams(location.search).get('accId');
    navigate(`/championships/${champ.id}/register${accId ? `?accId=${accId}` : ''}`, { replace: true });
  }, [qrCode, champ, user, location.search, navigate]);

  // Poll discreto: assim que o webhook do Asaas confirmar o pagamento, a
  // inscricao muda pra 'paga' no Firestore e o app leva o atleta pra
  // confirmacao automaticamente -- sem precisar de nenhum botao manual.
  useEffect(() => {
    if (!champ) return;
    const interval = setInterval(async () => {
      setChecking(true);
      try {
        const reg = await championshipService.getRegistration(champ.id);
        if (reg?.status === 'ACTIVE') {
          navigate(`/championships/${champ.id}/confirmed`);
        }
      } finally {
        setChecking(false);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [champ, navigate]);

  const handleCopyPix = () => {
    if (!qrCode) return;
    navigator.clipboard.writeText(qrCode.payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  if (champ === null) {
    return <div className="w-full min-h-screen bg-[#07090e]" />;
  }

  return (
    <div className="w-full min-h-screen bg-[#07090e] text-white pb-20 max-w-md mx-auto select-none flex flex-col justify-between">
      <div>
        <div className="bg-[#0f1422] border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between text-zinc-400 text-[11px] font-sans">
          <button onClick={() => navigate(`/championships/${id}/register`)} className="text-zinc-400 hover:text-white flex items-center gap-1">
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

          <h1 className="text-[17px] font-bold font-sans text-white">
            {champ?.title || 'Campeonato Invictus'}
          </h1>
          <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
            Inscrição oficial no campeonato
          </p>

          <div className="text-[24px] font-extrabold font-bebas tracking-wide text-white mt-2">
            R$ {(valor ?? champ?.registrationPrice ?? 0).toFixed(2).replace('.', ',')}
          </div>
        </div>

        <div className="px-5 pt-4">
          {loadError && (
            <div className="p-3 mb-4 rounded-xl bg-red-950/80 border border-red-500/50 text-red-300 text-[11px] font-sans">
              {loadError}
            </div>
          )}

          {qrCode ? (
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
                {checking && <RefreshCw size={11} className="animate-spin" />}
                Assim que o Pix for pago, a confirmação é automática.
              </p>
            </div>
          ) : (
            <div className="bg-[#121624] border border-zinc-800 rounded-2xl p-8 text-center space-y-3 shadow-xl">
              <RefreshCw size={22} className="animate-spin mx-auto text-zinc-500" />
              <p className="text-[12px] text-zinc-400 font-sans">Gerando cobrança Pix...</p>
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
};
