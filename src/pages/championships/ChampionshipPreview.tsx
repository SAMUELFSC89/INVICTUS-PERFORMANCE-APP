import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, CalendarClock, Dumbbell, Footprints, LockKeyhole, Medal, ShieldCheck, Trophy } from 'lucide-react';
import { InvictusLogo } from '../../components/InvictusLogo';
import './ChampionshipsNew.css';

type ChampionshipPreviewProps = { modality: 'musculacao' | 'cardio' };

export function ChampionshipPreview({ modality }: ChampionshipPreviewProps) {
  const navigate = useNavigate();
  const isStrength = modality === 'musculacao';
  const ModalityIcon = isStrength ? Dumbbell : Footprints;
  const title = isStrength ? 'CAMPEONATO DE FORÇA' : 'CAMPEONATO DE CARDIO';
  const activity = isStrength ? 'treinos de musculação' : 'atividades de cardio';

  return createPortal(<main className="ch-new-screen"><div className="ch-new-page ch-preview">
    <header className="ch-detail-header"><button onClick={() => navigate('/championships')} aria-label="Voltar aos campeonatos"><ArrowLeft /></button><div><InvictusLogo size={40} /><b>INVICTUS</b><small>PERFORMANCE</small></div><span /></header>
    <section className={`ch-preview-hero ${isStrength ? 'is-strength' : 'is-cardio'}`}><span className="ch-preview-icon"><ModalityIcon /></span><small>CAMPEONATO EM PREPARAÇÃO</small><h1>{title}</h1><p>Uma competição Invictus baseada em desempenho real, validação avançada e regras transparentes.</p><strong>EM BREVE</strong></section>
    <h2 className="ch-new-title">COMO VAI FUNCIONAR</h2><section className="ch-preview-steps">
      <article><CalendarClock /><span><b>1. INSCRIÇÃO</b>Quando o calendário oficial for divulgado, todas as condições aparecerão antes da confirmação.</span></article>
      <article><ModalityIcon /><span><b>2. ATIVIDADES REAIS</b>O participante registra {activity} dentro do aplicativo durante o período válido.</span></article>
      <article><ShieldCheck /><span><b>3. VALIDAÇÃO</b>Cada atividade passa pelo antifraude e somente registros aprovados seguem para a pontuação.</span></article>
      <article><BarChart3 /><span><b>4. CLASSIFICAÇÃO</b>O ranking será atualizado apenas com resultados elegíveis e critérios publicados no regulamento.</span></article>
      <article><Trophy /><span><b>5. RESULTADO</b>A classificação final será fechada após as validações e auditorias previstas.</span></article>
    </section>
    <h2 className="ch-new-title">O QUE SERÁ DIVULGADO</h2><section className="ch-preview-pending"><article><CalendarClock /><b>PERÍODO</b><span>Datas de inscrição e competição</span></article><article><Medal /><b>PREMIAÇÃO</b><span>Categoria e condições oficiais</span></article><article><LockKeyhole /><b>REGRAS</b><span>Elegibilidade e critérios de desempate</span></article></section>
    <section className="ch-preview-notice"><ShieldCheck /><div><b>NENHUMA INSCRIÇÃO ESTÁ ABERTA</b><p>Esta é uma prévia informativa. Valores, datas, premiação e regulamento ainda não foram definidos e não serão simulados.</p></div></section>
    <button className="ch-preview-back" onClick={() => navigate('/championships')}><ArrowLeft /> VOLTAR AOS CAMPEONATOS</button>
  </div></main>, document.body);
}
