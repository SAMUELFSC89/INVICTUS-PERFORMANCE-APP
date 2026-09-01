import { RankingSimulator } from '../components/professional/RankingSimulator';
import { ArrowLeft, Sliders } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function AdminRankingSimulator() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-6 pt-12 pb-8 space-y-4">
        <button 
          onClick={() => navigate('/admin')}
          className="flex items-center gap-2 text-on-surface-variant hover:text-white transition-colors text-xs font-black uppercase tracking-wider cursor-pointer"
        >
          <ArrowLeft size={14} />
          Voltar ao Painel Admin
        </button>
        
        <div className="flex items-center gap-3">
          <Sliders className="text-emerald-400" size={24} />
          <h1 className="font-headline italic font-black text-3xl text-on-surface uppercase tracking-tight">
            CALIBRAGEM DE GAMIFICAÇÃO
          </h1>
        </div>
        <p className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest leading-none">
          Simulador Inteligente de Rankings & Economia Invictus
        </p>
      </header>

      <div className="px-6">
        <RankingSimulator />
      </div>
    </div>
  );
}
