import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronRight, Dumbbell, Footprints } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { InvictusLogo } from './InvictusLogo';

export function ActivityTypeChooser() {
  const navigate = useNavigate();

  return createPortal(
    <main className="activity-type-screen">
      <div className="activity-type-page">
        <header className="activity-type-header">
          <button type="button" onClick={() => navigate(-1)} aria-label="Voltar">
            <ArrowLeft />
          </button>
          <div>
            <InvictusLogo size={40} />
            <span><b>INVICTUS</b><small>PERFORMANCE</small></span>
          </div>
          <span aria-hidden="true" />
        </header>

        <section className="activity-type-heading" aria-labelledby="activity-type-title">
          <small>INICIAR ATIVIDADE</small>
          <h1 id="activity-type-title">O QUE VOCÊ VAI TREINAR?</h1>
          <p>Escolha uma modalidade para continuar.</p>
        </section>

        <section className="activity-type-options" aria-label="Escolha da modalidade">
          <button type="button" className="activity-type-option" onClick={() => navigate('/musculacao')}>
            <span className="activity-type-icon"><Dumbbell /></span>
            <span className="activity-type-copy">
              <small>FORÇA E HIPERTROFIA</small>
              <strong>MUSCULAÇÃO</strong>
              <em>Seu plano, cargas e evolução.</em>
            </span>
            <ChevronRight />
          </button>

          <button type="button" className="activity-type-option" onClick={() => navigate('/challenges/cardio')}>
            <span className="activity-type-icon"><Footprints /></span>
            <span className="activity-type-copy">
              <small>RESISTÊNCIA E CONDICIONAMENTO</small>
              <strong>CARDIO</strong>
              <em>Corrida, bike e atividades ao ar livre.</em>
            </span>
            <ChevronRight />
          </button>
        </section>

        <p className="activity-type-note">Você poderá escolher o tipo específico de cardio na próxima tela.</p>
      </div>
    </main>,
    document.body,
  );
}
