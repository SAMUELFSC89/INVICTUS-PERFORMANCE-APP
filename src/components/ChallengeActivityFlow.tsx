import { createPortal } from 'react-dom';
import { AlertCircle, ArrowLeft, Bike, Check, ChevronDown, ChevronRight, Clock3, Dumbbell, Flag, Gauge, MapPin, Navigation, Pause, PersonStanding, Play, Plus, Share2, ShieldCheck, Timer, Waves, XCircle, Zap } from 'lucide-react';
import type { ActivitySession } from '../types';
import { ActivityMapView } from './ActivityMapView';
import { LiveTrackingMap, GpsSignalIndicator } from './LiveTrackingMap';
import { getModalityConfig } from '../config/cardioConfig';
import { InvictusLogo } from './InvictusLogo';
import { WorkoutActiveScreen } from './WorkoutActiveScreen';

export type ChallengeFlowScreen = 'workout-details' | 'workout-checkin' | 'cardio-picker' | 'active' | 'workout-complete' | 'cardio-complete' | 'cardio-summary' | 'day-progress';

export type CardioOption = { id: string; label: string; icon: 'run' | 'walk' | 'bike' | 'treadmill' | 'elliptical' | 'stairs' | 'row' | 'swim' | 'hiit'; gps: boolean };
export const CARDIO_OPTIONS: CardioOption[] = [
  { id: 'running', label: 'Corrida ao ar livre', icon: 'run', gps: true },
  { id: 'walking', label: 'Caminhada ao ar livre', icon: 'walk', gps: true },
  { id: 'bike', label: 'Bike ao ar livre', icon: 'bike', gps: true },
  { id: 'treadmill', label: 'Esteira', icon: 'treadmill', gps: false },
  { id: 'stationary_bike', label: 'Bike ergométrica', icon: 'bike', gps: false },
  { id: 'elliptical', label: 'Elíptico / Transport', icon: 'elliptical', gps: false },
  { id: 'rowing', label: 'Remo indoor', icon: 'row', gps: false },
  { id: 'stair_climber', label: 'Escada / Stairmaster', icon: 'stairs', gps: false },
  { id: 'swimming', label: 'Natação', icon: 'swim', gps: false },
  { id: 'hiit', label: 'HIIT / Funcional', icon: 'hiit', gps: false }
];
const groups = ['Peito', 'Costas', 'Pernas', 'Ombros', 'Braços', 'Abdômen', 'Corpo todo'];
const RunningGlyph = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="15.5" cy="4.25" r="2.1" fill="currentColor" />
    <path d="m12.25 7.15-2.6 3.2-3.35 1.12a1.25 1.25 0 0 0 .78 2.38l3.7-1.22c.24-.08.45-.23.61-.42l1.12-1.35 1.35 2.35-2.65 2.14c-.16.13-.29.3-.37.49l-1.7 4.25a1.3 1.3 0 0 0 2.41.97l1.58-3.93 2.55-1.9 1.05 1.65c.14.22.35.39.59.49l3.45 1.42a1.3 1.3 0 0 0 .99-2.4l-3.08-1.27-2.22-3.74 1.15-1.36 1.56 1.15c.21.16.47.24.74.24h2.27a1.2 1.2 0 1 0 0-2.4h-1.86l-2.92-2.15a2.65 2.65 0 0 0-3.62.43Z" fill="currentColor" />
  </svg>
);
const icon = (kind: CardioOption['icon'], size = 20) => kind === 'bike' ? <Bike size={size} /> : kind === 'swim' ? <Waves size={size} /> : kind === 'treadmill' ? <Gauge size={size} /> : kind === 'row' ? <Dumbbell size={size} /> : kind === 'stairs' ? <Navigation size={size} /> : kind === 'hiit' ? <Zap size={size} /> : kind === 'walk' ? <PersonStanding size={size} /> : <RunningGlyph size={size} />;
const time = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

export type ActivityCompletion = {
  status: 'approved' | 'pending' | 'rejected';
  message?: string;
  pointsAwarded?: number;
};

export function ChallengeActivityFlow({
  screen,
  group,
  onGroup,
  cardio,
  onCardio,
  session,
  elapsed,
  distance,
  currentSpeedKmH,
  trajectory,
  liveCheckpoints,
  gpsAccuracy = null,
  gpsSignal = 'SEARCHING',
  gpsPermissionDenied = false,
  gymName,
  completedChallengeIds,
  completion,
  startError,
  endError,
  loading = false,
  startingActivity = false,
  onBack,
  onStart,
  onEnd,
  onTogglePause,
  onSummary,
  onDone,
  onCancel,
  onShare,
  onDetail
}: {
  screen: ChallengeFlowScreen;
  group: string;
  onGroup: (value: string) => void;
  cardio: CardioOption;
  onCardio: (value: CardioOption) => void;
  session: ActivitySession | null;
  elapsed: number;
  distance: number;
  currentSpeedKmH?: number | null;
  trajectory?: Array<{ lat: number; lng: number }>;
  liveCheckpoints?: Array<{ location: { lat: number; lng: number; accuracy?: number } }>;
  gpsAccuracy?: number | null;
  gpsSignal?: 'SEARCHING' | 'WEAK' | 'STRONG';
  gpsPermissionDenied?: boolean;
  gymName: string;
  completedChallengeIds: string[];
  completion?: ActivityCompletion | null;
  startError?: string | null;
  endError?: string | null;
  loading?: boolean;
  startingActivity?: boolean;
  onBack: () => void;
  onStart: (type: 'workout' | 'cardio') => void;
  onEnd: () => void;
  onTogglePause?: () => void;
  onSummary: () => void;
  onDone: () => void;
  onCancel?: () => void;
  onShare?: () => void;
  onDetail?: () => void;
}) {
  const activeCardio = session?.type === 'cardio' || screen === 'cardio-complete' || screen === 'cardio-summary' || screen === 'cardio-picker';
  const modalityCfg = getModalityConfig(session?.cardioType || cardio.id);
  const effectiveCardioLabel = session?.cardioTypeLabel || modalityCfg?.label || cardio.label;
  const effectiveMuscleGroup = session?.muscleGroup || group;
  const activeTitle = (session?.type === 'cardio' || screen === 'cardio-complete' || screen === 'cardio-summary')
    ? effectiveCardioLabel
    : `Treino de ${effectiveMuscleGroup}`;
  const isBike = session?.cardioType === 'bike' || cardio.id === 'bike';
  const averageSpeedKmH = distance > 0.01 && elapsed > 0 ? (distance / (elapsed / 3600)).toFixed(1) : '—';
  const liveBikeSpeed = typeof currentSpeedKmH === 'number' && Number.isFinite(currentSpeedKmH)
    ? currentSpeedKmH.toFixed(1)
    : averageSpeedKmH;
  const pace = distance > 0.01 && elapsed ? `${Math.floor((elapsed / 60) / distance)}'${String(Math.round((elapsed / 60 / distance % 1) * 60)).padStart(2, '0')}"` : '—';
  const hasDistanceMetric = Boolean(modalityCfg ? modalityCfg.hasDistance : (session?.requiresGpsDistance || cardio.gps));
  const hasPaceMetric = Boolean(modalityCfg ? modalityCfg.hasPace : !isBike);
  const checkin = screen === 'workout-checkin';
  const complete = screen === 'workout-complete' || screen === 'cardio-complete';
  const subtitle = screen === 'workout-details'
    ? 'DETALHES DO DESAFIO'
    : screen === 'cardio-picker'
      ? 'SELECIONE O TIPO DE CARDIO'
      : checkin
        ? 'CHECK-IN DE PRESENÇA'
        : screen === 'active'
          ? (session?.type === 'cardio' ? 'CARDIO EM ANDAMENTO' : 'TREINO EM ANDAMENTO')
          : complete
            ? (screen === 'cardio-complete' ? 'CARDIO CONCLUÍDO!' : 'TREINO CONCLUÍDO!')
            : screen === 'cardio-summary'
              ? 'RESUMO DA ATIVIDADE'
              : 'DESAFIOS DO DIA';
  const workoutCompleted = completedChallengeIds.includes('workout');
  const cardioCompleted = completedChallengeIds.includes('cardio');
  const completedToday = [workoutCompleted, cardioCompleted].filter(Boolean).length;
  const awardedPoints = typeof completion?.pointsAwarded === 'number' && Number.isFinite(completion.pointsAwarded) && completion.pointsAwarded > 0
    ? completion.pointsAwarded
    : null;

  // #116: .challenge-flow-screen e position:fixed;inset:0;z-index:70 pensado
  // pra cobrir a tela INTEIRA por cima de tudo, inclusive o menu inferior
  // (#bottom-nav, z-index:30). Mas antes este componente renderizava inline,
  // como filho de <main className="... relative z-[2] ...."> em Layout.tsx.
  // Um elemento position:relative + z-index cria seu proprio contexto de
  // empilhamento: o z-index:70 daqui so competia DENTRO desse <main>, que por
  // fora participava do empilhamento do documento com z-index:2 -- menor que
  // o z-index:30 do nav, que e irmao de <main>, nao filho. Resultado: o nav
  // sempre pintava por cima da parte de baixo desta tela (ex: o botao
  // "FINALIZAR ATIVIDADE" ficava coberto, existindo no DOM mas invisivel e
  // impossivel de tocar). Renderizar via portal direto em document.body tira
  // este componente de dentro do contexto de empilhamento do <main> e resolve
  // na raiz, sem depender de ajustar z-index em cascata.
  return createPortal(
    <main className={`challenge-flow-screen ${screen === 'active' && session?.type === 'cardio' && session?.requiresGpsDistance ? 'is-cardio-live' : ''} ${screen === 'active' && session?.type === 'workout' ? 'is-workout-live' : ''}`}>
      <header className="challenge-flow-header">
        <button aria-label="Voltar" onClick={onBack}>
          <ArrowLeft />
        </button>
        <h1>{subtitle}</h1>
      </header>

      {screen === 'workout-details' && (
        <section className="challenge-flow-card challenge-flow-details">
          <div className="challenge-flow-title">
            <span className="challenge-flow-icon"><Dumbbell /></span>
            <div>
              <small>{workoutCompleted ? 'CONCLUÍDO HOJE' : 'ATIVIDADE PRINCIPAL'}</small>
              <h2>TREINO DE MUSCULAÇÃO</h2>
              <b>Pontuação definida após validação</b>
            </div>
          </div>
          <p>Realize um treino completo na academia e registre a atividade para análise.</p>
          <div className="challenge-flow-panel">
            <strong>SELECIONE O GRUPO MUSCULAR</strong>
            <div className="challenge-flow-groups">
              {groups.map(item => (
                <button
                  className={group === item ? 'is-selected' : ''}
                  onClick={() => onGroup(item)}
                  key={item}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="challenge-flow-panel">
            <strong>PROGRESSO DO DESAFIO <em>{workoutCompleted ? '1/1' : '0/1'}</em></strong>
            <p>{workoutCompleted ? 'Treino validado hoje.' : 'Complete um treino de musculação validado hoje.'}</p>
          </div>
          <div className="challenge-flow-panel">
            <strong>REQUISITOS</strong>
            <ul>
              <li><MapPin />Presença na academia verificada no início</li>
              <li><Clock3 />Treino de 30 a 90 minutos</li>
              <li><Timer />Dados de frequência quando houver sensor conectado</li>
            </ul>
          </div>
          <button
            className="challenge-flow-primary"
            onClick={() => onStart('workout')}
            disabled={workoutCompleted || startingActivity}
          >
            <Play />{workoutCompleted ? 'TREINO JÁ VALIDADO' : startingActivity ? 'INICIANDO...' : 'INICIAR TREINO'}
          </button>
        </section>
      )}

      {screen === 'cardio-picker' && (
        <section className="challenge-flow-card challenge-flow-cardio-picker">
          <p>Escolha a modalidade que você irá realizar.</p>
          <div className="challenge-flow-cardio-grid">
            {CARDIO_OPTIONS.map(item => (
              <button
                className={cardio.id === item.id ? 'is-selected' : ''}
                key={item.id}
                onClick={() => onCardio(item)}
              >
                {icon(item.icon)}
                <span>{item.label}</span>
                <small>{item.gps ? 'Com GPS' : 'Sem GPS'}</small>
              </button>
            ))}
          </div>
          <p className="challenge-flow-note">
            <Navigation /> Corrida, caminhada e bike ao ar livre usam GPS.
          </p>
          <button className="challenge-flow-primary" onClick={() => onStart('cardio')} disabled={startingActivity}>
            <Play />{startingActivity ? 'INICIANDO...' : 'INICIAR CARDIO'}
          </button>
        </section>
      )}

      {checkin && (
        <section className="challenge-flow-checkin">
          <p>Confirme sua localização na academia antes de iniciar o treino.</p>
          <div className="challenge-flow-radar"><MapPin /></div>
          <span>{startError ? 'Validação de presença não concluída.' : 'Aguardando a confirmação da sua localização.'}</span>
          <article className={startError ? 'is-blocked' : ''}>
            <small>{startError ? 'LOCALIZAÇÃO NÃO VALIDADA' : 'PRONTO PARA VERIFICAR'}</small>
            <b>{gymName || 'Sua academia'}</b>
            <p>{startError || 'Toque abaixo para validar sua localização antes de iniciar.'}</p>
            {startError ? <MapPin /> : <Check />}
          </article>
          <button className="challenge-flow-primary" onClick={() => onStart('workout')} disabled={startingActivity}>
            <Check />{startingActivity ? 'VALIDANDO...' : startError ? 'TENTAR NOVAMENTE' : 'VALIDAR E INICIAR'}
          </button>
        </section>
      )}

      {screen === 'active' && session?.type === 'cardio' && session?.requiresGpsDistance && (
        <section className="challenge-cardio-live">
          <div className="challenge-cardio-live-topbar">
            <button type="button" onClick={onBack} aria-label="Voltar"><ChevronDown /></button>
            <div><InvictusLogo size={29} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div>
          </div>

          <LiveTrackingMap
            points={(liveCheckpoints || []).map(cp => ({ lat: cp.location.lat, lng: cp.location.lng, accuracy: cp.location.accuracy }))}
            gpsAccuracy={gpsAccuracy}
            gpsSignal={gpsSignal}
            permissionDenied={gpsPermissionDenied}
            heightPx={Math.max(350, Math.min(540, typeof window !== 'undefined' ? window.innerHeight * .59 : 460))}
          />

          <div className="challenge-cardio-live-content">
            <article className="challenge-cardio-live-stats">
              <header>
                <span>{icon(cardio.icon, 24)}</span>
                <strong>{activeTitle}</strong>
                <ShieldCheck />
              </header>
              <div>
                <article><Clock3 /><b>{time(elapsed)}</b><small>Tempo</small></article>
                <article><Navigation /><b>{distance.toFixed(2)}</b><small>Distância (km)</small></article>
                <article><Gauge /><b>{hasPaceMetric ? pace : liveBikeSpeed}</b><small>{hasPaceMetric ? 'Pace médio' : 'Velocidade (km/h)'}</small></article>
              </div>
            </article>

            <div className="challenge-cardio-live-status">
              <ShieldCheck />
              <span><b>{session?.isPaused ? 'ATIVIDADE PAUSADA' : 'ATIVIDADE SENDO REGISTRADA...'}</b><small>Mantenha o GPS ativo para que o treino seja validado.</small></span>
            </div>

            {endError && <div className="challenge-flow-end-error"><AlertCircle size={16} /><span>{endError}</span></div>}

            <div className="challenge-cardio-live-actions">
              {onTogglePause && <button type="button" onClick={onTogglePause} disabled={loading}>{session?.isPaused ? <Play /> : <Pause />}<span>{session?.isPaused ? 'RETOMAR' : 'PAUSAR'}</span></button>}
              <button type="button" className="is-finish" onClick={onEnd} disabled={loading}><Flag /><span>{loading ? 'FINALIZANDO...' : 'FINALIZAR'}</span></button>
            </div>
            {onCancel && <button type="button" className="challenge-cardio-live-cancel" onClick={onCancel}><XCircle /> Descartar atividade</button>}
            <GpsSignalIndicator accuracy={gpsAccuracy} signal={gpsSignal} />
          </div>
        </section>
      )}

      {screen === 'active' && session?.type === 'workout' && (
        <WorkoutActiveScreen
          session={session}
          elapsed={elapsed}
          loading={loading}
          endError={endError}
          onBack={onBack}
          onTogglePause={onTogglePause}
          onEnd={onEnd}
          onCancel={onCancel}
        />
      )}

      {screen === 'active' && session?.type === 'cardio' && !session.requiresGpsDistance && (
        <section className="challenge-flow-active">
          <button className="challenge-flow-activity-type">
            {activeTitle}<ChevronDown />
          </button>
          <span className="challenge-flow-gps">
            <Zap /> {session?.isPaused ? 'EM PAUSA' : session?.requiresGpsDistance ? 'GPS CONECTADO' : (session?.type === 'cardio' ? 'CARDIO INDOOR' : 'ATIVIDADE EM ANDAMENTO')}
          </span>
          {/* #120: handleEndActivity() mantem a sessao ativa em caso de falha
              (rede/servidor) pra permitir tentar de novo, mas o erro (`error`
              em Challenges.tsx) rendeirava numa banner por tras deste overlay
              de tela cheia -- o atleta so via o botao voltar pra
              "FINALIZAR ATIVIDADE" sem NENHUMA explicacao do que deu errado,
              parecendo que nada tinha acontecido. Mostrando aqui, dentro da
              propria tela ativa, onde o atleta de fato consegue ver. */}
          {endError && (
            <div className="challenge-flow-end-error">
              <AlertCircle size={16} />
              <span>{endError}</span>
            </div>
          )}
          {session?.requiresGpsDistance && (
            <>
              <LiveTrackingMap
                points={(liveCheckpoints || []).map(cp => ({ lat: cp.location.lat, lng: cp.location.lng, accuracy: (cp.location as any).accuracy }))}
                gpsAccuracy={gpsAccuracy}
                gpsSignal={gpsSignal}
                permissionDenied={gpsPermissionDenied}
              />
              <GpsSignalIndicator accuracy={gpsAccuracy} signal={gpsSignal} />
            </>
          )}
          <article className="challenge-flow-clock">
            <strong>{time(elapsed)}</strong>
            <small>Tempo decorrido</small>
          </article>
          <div className="challenge-flow-kpis">
            {session?.type === 'cardio' ? (
              hasDistanceMetric ? (
                <>
                  <article><b>{distance.toFixed(2)}</b><span>Distância (km)</span></article>
                <article><b>{hasPaceMetric ? pace : `${liveBikeSpeed} km/h`}</b><span>{hasPaceMetric ? 'Pace médio (min/km)' : 'Velocidade atual'}</span></article>
                  <article><b>—</b><span>Calorias (kcal)</span></article>
                </>
              ) : (
                <>
                  <article><b>{time(elapsed)}</b><span>Tempo decorrido</span></article>
                  <article><b>Indoor</b><span>Tipo de treino</span></article>
                  <article><b>—</b><span>FC média (bpm)</span></article>
                </>
              )
            ) : (
              <>
                <article><b>—</b><span>FC média (bpm)</span></article>
                <article><b>—</b><span>Calorias (kcal)</span></article>
                <article><b>—</b><span>Carga (ton)</span></article>
                <article><b>—</b><span>Intensidade</span></article>
              </>
            )}
          </div>
          {session?.type !== 'cardio' && (
            <article className="challenge-flow-zone">
              <strong>ZONA CARDÍACA</strong>
              <div><i /><i /><i /><i /></div>
              <p>Dados exibidos somente quando houver sensor conectado.</p>
            </article>
          )}
          {onTogglePause && (
            // #324: semaforo, cadarco, banheiro -- sem pausa, a unica opcao
            // ate aqui era encerrar de verdade ou aceitar que o pace/tempo
            // continuassem correndo parado.
            <button
              type="button"
              className="challenge-flow-secondary mb-2 flex items-center justify-center gap-1"
              onClick={onTogglePause}
              disabled={loading}
            >
              {session?.isPaused ? <Play size={16} className="fill-current" /> : <Pause size={16} className="fill-current" />}
              <span>{session?.isPaused ? 'RETOMAR' : 'PAUSAR'}</span>
            </button>
          )}
          <button
            className="challenge-flow-primary"
            onClick={onEnd}
            disabled={loading}
          >
            {loading ? 'FINALIZANDO...' : (session?.type === 'cardio' ? 'FINALIZAR ATIVIDADE' : 'FINALIZAR TREINO')}
          </button>
          {onCancel && (
            // #323: fica habilitado mesmo com `loading` true de proposito -- se o
            // envio de finalizacao ficar pendurado (sem sinal, ex: dentro de um
            // veiculo em movimento), este e o unico jeito do atleta sair da tela
            // sem forcar o fechamento do app. onCancel (handleCancelActivity)
            // aborta o envio pendente antes de descartar a sessao.
            <button
              type="button"
              className="challenge-flow-secondary mt-2 flex items-center justify-center gap-1 text-rose-400 hover:text-rose-300 transition-colors"
              onClick={onCancel}
            >
              <XCircle size={14} />
              <span>{loading ? 'Cancelar envio e descartar' : 'Descartar e cancelar sessão'}</span>
            </button>
          )}
        </section>
      )}

      {complete && (
        <section className="challenge-flow-complete">
          <div className="challenge-flow-confetti">✦ ✦ ✦ ✦ ✦</div>
          <span className="challenge-flow-check"><Check /></span>
          <p>{completion?.message || 'Atividade validada pelo servidor.'}</p>
          {awardedPoints !== null ? (
            <strong>+{awardedPoints} XP <Zap /></strong>
          ) : (
            <strong className="text-[15px]">Pontuação registrada pelo servidor</strong>
          )}
          <article>
            <b>{screen === 'cardio-complete' ? effectiveCardioLabel.toUpperCase() : 'TREINO DE MUSCULAÇÃO'}</b>
            <small>1/1</small>
            <div />
          </article>
          <button className="challenge-flow-primary" onClick={onSummary}>
            {screen === 'cardio-complete' ? 'VER RESUMO' : 'VER DESAFIOS DO DIA'}
          </button>
          <button className="challenge-flow-secondary" onClick={onDone}>
            VOLTAR PARA DESAFIOS
          </button>
        </section>
      )}

      {screen === 'cardio-summary' && (
        <section className="challenge-flow-summary">
          <div className="challenge-flow-summary-title">
            <div>
              <h2>{effectiveCardioLabel}</h2>
              <p>Atividade registrada com dados reais.</p>
            </div>
            <span>{time(elapsed)}</span>
          </div>
          {trajectory && trajectory.length >= 2 ? (
            <ActivityMapView trajectory={trajectory} heightPx={220} />
          ) : modalityCfg?.hasRouteMap ? (
            <div className="challenge-flow-map is-empty">
              <MapPin />
              <span>O mapa estará disponível após o GPS registrar o percurso.</span>
            </div>
          ) : null}
          <div className="challenge-flow-summary-kpis">
            <article><b>{time(elapsed)}</b><small>DURAÇÃO</small></article>
            {hasDistanceMetric ? (
              <>
                <article><b>{distance.toFixed(2)} km</b><small>DISTÂNCIA</small></article>
                <article><b>{hasPaceMetric ? pace : `${averageSpeedKmH} km/h`}</b><small>{hasPaceMetric ? 'PACE MÉDIO' : 'VELOCIDADE MÉDIA'}</small></article>
              </>
            ) : (
              <>
                <article><b>Indoor</b><small>MODALIDADE</small></article>
                <article><b>Validado</b><small>STATUS</small></article>
              </>
            )}
          </div>
          {onShare && (
            <button className="challenge-flow-primary mt-3 flex items-center justify-center gap-2" onClick={onShare}>
              <Share2 size={16} />
              <span>COMPARTILHAR ATIVIDADE</span>
            </button>
          )}
          {onDetail && (
            <button className="challenge-flow-secondary mt-1" onClick={onDetail}>
              VER DETALHES COMPLETOS
            </button>
          )}
          <button className="challenge-flow-secondary" onClick={onDone}>
            VOLTAR PARA DESAFIOS
          </button>
        </section>
      )}

      {screen === 'day-progress' && (
        <section className="challenge-flow-day-progress">
          <p>Progresso dos desafios validados hoje</p>
          <strong>{completedToday}/2</strong>
          <div className="challenge-flow-day-track">
            <i style={{ width: `${Math.min(100, completedToday * 50)}%` }} />
          </div>
          <article>
            <span className={workoutCompleted ? 'is-complete' : ''}><Check /></span>
            <b>TREINO DE MUSCULAÇÃO</b>
            <em>{workoutCompleted ? 'VALIDADO' : 'PENDENTE'}</em>
          </article>
          <article>
            <span className={cardioCompleted ? 'is-complete' : ''}><Check /></span>
            <b>CARDIO AERÓBICO</b>
            <em>{cardioCompleted ? 'VALIDADO' : 'PENDENTE'}</em>
          </article>
          <button className="challenge-flow-primary" onClick={onDone}>
            VOLTAR PARA DESAFIOS
          </button>
        </section>
      )}
    </main>,
    document.body
  );
}
