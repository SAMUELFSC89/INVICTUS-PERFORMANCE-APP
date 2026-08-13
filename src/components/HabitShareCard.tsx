import React, { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { X, Download, Share2, Loader2 } from 'lucide-react';
import { HabitGoal } from '../services/habitService';

interface Props {
  habit: HabitGoal;
  onClose: () => void;
}

/**
 * Share card for the "Criar Hábito" journey. Reuses the exact same pattern already
 * used by RunShareCard.tsx and Achievements.tsx: an off-screen 1080x1920 div captured
 * with html-to-image's toPng() into a PNG data URL, then either downloaded via a
 * synthetic <a download> link or shared via the Web Share API (with file support).
 *
 * Privacy: nothing beyond the current milestone's rank ("etapa X de Y") and total
 * sessions is shown by default. The exact final target distance, the deadline date,
 * and the total session count are each gated behind their own explicit consent
 * checkbox (all OFF by default) — matching the same opt-in pattern requested for
 * cardio session sharing (distance/duration/pace/HR must be explicitly authorized).
 */
export function HabitShareCard({ habit, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [consent, setConsent] = useState({
    targetDistance: false,
    sessionsCount: false,
    deadline: false,
  });

  const toggle = (key: keyof typeof consent) =>
    setConsent((c) => ({ ...c, [key]: !c[key] }));

  const currentOrder = habit.currentMilestoneIndex + 1;
  const totalMilestones = habit.milestones.length;

  const generate = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    setGenerating(true);
    try {
      await new Promise((r) => setTimeout(r, 100));
      return await toPng(cardRef.current, { canvasWidth: 1080, canvasHeight: 1920, pixelRatio: 2 });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    const dataUrl = await generate();
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.download = `invictus-habito-${habit.id}.png`;
    link.href = dataUrl;
    link.click();
  };

  const handleShare = async () => {
    const dataUrl = await generate();
    if (!dataUrl) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'invictus-habito.png', { type: 'image/png' });
      if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
        await (navigator as any).share({ files: [file], title: 'Minha evolução Invictus' });
        return;
      }
    } catch (e) {
      console.warn('[HabitShareCard] Web Share indisponível, caindo para download:', e);
    }
    handleDownload();
  };

  return (
    <div className="fixed inset-0 z-[600] bg-black/85 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface-card border border-white/10 rounded-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Compartilhar Evolução</h3>
          <button onClick={onClose} aria-label="Fechar">
            <X size={18} className="text-text-secondary" />
          </button>
        </div>

        <p className="text-xs text-text-secondary">
          Escolha o que aparece no seu card. Nenhuma informação sensível é incluída a menos que você marque abaixo.
        </p>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-white">
            <input type="checkbox" checked={consent.targetDistance} onChange={() => toggle('targetDistance')} />
            Objetivo final (distância exata)
          </label>
          <label className="flex items-center gap-2 text-xs text-white">
            <input type="checkbox" checked={consent.sessionsCount} onChange={() => toggle('sessionsCount')} />
            Total de sessões registradas
          </label>
          <label className="flex items-center gap-2 text-xs text-white">
            <input type="checkbox" checked={consent.deadline} onChange={() => toggle('deadline')} />
            Prazo/data limite do desafio
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary opacity-60">
            <input type="checkbox" checked={false} disabled />
            Rota/localização (nunca incluída nesta versão)
          </label>
        </div>

        {/* Off-screen render target — mesmo padrão de RunShareCard.tsx / Achievements.tsx */}
        <div className="absolute left-[-9999px] top-[-9999px] select-none pointer-events-none">
          <div
            ref={cardRef}
            style={{
              width: '1080px',
              height: '1920px',
              background: 'radial-gradient(circle at top, #7c2d12, #0a0a0a 70%)',
              color: '#fff',
              padding: '80px 60px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              fontFamily: 'sans-serif',
            }}
          >
            <div>
              <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: 2 }}>INVICTUS</div>
              <div style={{ fontSize: 26, opacity: 0.8, marginTop: 8 }}>🔥 CRIAR HÁBITO</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 90, fontWeight: 900, color: '#fb923c', margin: '24px 0' }}>
                Etapa {currentOrder}/{totalMilestones}
              </div>
              <div style={{ fontSize: 28, opacity: 0.75 }}>
                🔥 {consent.sessionsCount ? `${habit.totalSessionsCompleted} sessões registradas` : 'Jornada em andamento'}
              </div>
              {consent.targetDistance && (
                <div style={{ marginTop: 24, fontSize: 26 }}>🏆 Objetivo final: {habit.targetDistanceKm} km</div>
              )}
              {consent.deadline && (
                <div style={{ marginTop: 12, fontSize: 22, opacity: 0.7 }}>
                  Prazo: {new Date(habit.deadline).toLocaleDateString('pt-BR')}
                </div>
              )}
            </div>
            <div style={{ fontSize: 20, opacity: 0.5, textAlign: 'center' }}>invictusperformance.app.br</div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            disabled={generating}
            className="flex-1 py-3 rounded-xl border border-white/15 font-semibold text-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Salvar imagem
          </button>
          <button
            onClick={handleShare}
            disabled={generating}
            className="flex-1 py-3 rounded-xl bg-primary text-black font-semibold text-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Compartilhar
          </button>
        </div>
        <p className="text-[10px] text-text-secondary/70 text-center">
          Funciona para Instagram Stories, WhatsApp e Instagram (compartilhamento nativo do dispositivo) ou salvar localmente.
        </p>
      </div>
    </div>
  );
}
