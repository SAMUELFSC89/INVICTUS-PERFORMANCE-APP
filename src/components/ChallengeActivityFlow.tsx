import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Bike, Check, ChevronDown, ChevronRight, Clock3, Dumbbell, Flag, Gauge, MapPin, MoreVertical, Navigation, Pause, PersonStanding, Play, ShieldCheck, Timer, Waves, XCircle, Zap } from 'lucide-react';
import type { ActivitySession } from '../types';
import { LiveTrackingMap, GpsSignalIndicator } from './LiveTrackingMap';
import { getModalityConfig } from '../config/cardioConfig';
import { InvictusLogo } from './InvictusLogo';
import { WorkoutActiveScreen } from './WorkoutActiveScreen';
import { ScoringModeToggle } from './ScoringModeToggle';
import { formatPaceFromSpeed, formatPaceValue } from '../lib/runUtils';

export type ChallengeFlowScreen = 'workout-details' | 'workout-checkin' | 'cardio-picker' | 'active' | 'workout-complete' | 'day-progress';

export type CardioOption = {
  id: string;
  label: string;
  description: string;
  icon: 'run' | 'walk' | 'bike' | 'treadmill' | 'elliptical' | 'stairs' | 'row' | 'swim' | 'hiit';
  gps: boolean;
};
export const CARDIO_OPTIONS: CardioOption[] = [
  { id: 'running', label: 'Corrida ao ar livre', description: 'Distância, pace e rota no mapa', icon: 'run', gps: true },
  { id: 'walking', label: 'Caminhada ao ar livre', description: 'Distância, pace e rota no mapa', icon: 'walk', gps: true },
  { id: 'bike', label: 'Bike ao ar livre', description: 'Distância, velocidade e rota', icon: 'bike', gps: true },
  { id: 'treadmill', label: 'Esteira', description: 'Tempo, distância e velocidade', icon: 'treadmill', gps: false },
  { id: 'stationary_bike', label: 'Bike ergométrica', description: 'Tempo, distância e velocidade', icon: 'bike', gps: false },
  { id: 'elliptical', label: 'Elíptico / Transport', description: 'Treino registrado por tempo', icon: 'elliptical', gps: false },
  { id: 'rowing', label: 'Remo indoor', description: 'Treino registrado por tempo', icon: 'row', gps: false },
  { id: 'stair_climber', label: 'Escada / Stairmaster', description: 'Treino registrado por tempo', icon: 'stairs', gps: false },
  { id: 'swimming', label: 'Natação', description: 'Treino registrado por tempo', icon: 'swim', gps: false },
  { id: 'hiit', label: 'HIIT / Funcional', description: 'Treino registrado por tempo', icon: 'hiit', gps: false }
];
const featuredCardioOptions = CARDIO_OPTIONS.filter(item => ['running', 'walking', 'bike', 'treadmill'].includes(item.id));
const extraCardioOptions = CARDIO_OPTIONS.filter(item => !['running', 'walking', 'bike', 'treadmill'].includes(item.id));
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
  status: 'recorded' | 'approved' | 'pending' | 'rejected';
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
  currentSpeedUpdatedAt,
  liveCheckpoints,
  gpsAccuracy = null,
  gpsSignal = 'SEARCHING',
  gpsPermissionDenied = false,
  gpsStalled = false,
  onRetryGps,
  gymName,
  checkInRequired = false,
  completedChallengeIds,
  completion,
  startError,
  endError,
  statusMessage,
  loading = false,
  startingActivity = false,
  scoringEnabled = true,
  onScoringChange,
  onBack,
  onStart,
  onEnd,
  onTogglePause,
  onSummary,
  onDone,
  onCancel
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
  currentSpeedUpdatedAt?: number | null;
  liveCheckpoints?: Array<{ location: { lat: number; lng: number; accuracy?: number } }>;
  gpsAccuracy?: number | null;
  gpsSignal?: 'SEARCHING' | 'WEAK' | 'STRONG';
  gpsPermissionDenied?: boolean;
  gpsStalled?: boolean;
  onRetryGps?: () => void;
  gymName: string;
  checkInRequired?: boolean;
  completedChallengeIds: string[];
  completion?: ActivityCompletion | null;
  startError?: string | null;
  endError?: string | null;
  statusMessage?: string | null;
  loading?: boolean;
  startingActivity?: boolean;
  scoringEnabled?: boolean;
  onScoringChange?: (enabled: boolean) => void;
  onBack: () => void;
  onStart: (type: 'workout' | 'cardio', options?: { checkIn?: boolean }) => void;
  onEnd: () => void;
  onTogglePause?: () => void;
  onSummary: () => void;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [cardioMenuOpen, setCardioMenuOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showMoreCardio, setShowMoreCardio] = useState(false);
  const autoStartAttempts = useRef(0);
  const modalityCfg = getModalityConfig(session?.cardioType || cardio.id);
  const effectiveCardioLabel = session?.cardioTypeLabel || modalityCfg?.label || cardio.label;
  const effectiveMuscleGroup = session?.muscleGroup || group;
  const activeTitle = session?.type === 'cardio'
    ? effectiveCardioLabel
    : `Treino de ${effectiveMuscleGroup}`;
  const speedIsFresh = typeof currentSpeedKmH === 'number'
    && Number.isFinite(currentSpeedKmH)
    && typeof currentSpeedUpdatedAt === 'number'
    && Date.now() - currentSpeedUpdatedAt <= 8000
    && !session?.isPaused;
  const currentSpeed = speedIsFresh ? currentSpeedKmH! : null;
  const currentSpeedLabel = currentSpeed !== null ? currentSpeed.toFixed(1) : '—';
  const hasDistanceMetric = Boolean(modalityCfg ? modalityCfg.hasDistance : (session?.requiresGpsDistance || cardio.gps));
  const hasPaceMetric = hasDistanceMetric;
  const currentPace = hasPaceMetric ? formatPaceFromSpeed(currentSpeed) : null;
  const currentPaceLabel = currentPace || '—';
  const averagePace = formatPaceValue(distance, elapsed) || '—';
  const checkin = screen === 'workout-checkin';
  const complete = screen === 'workout-complete';
  const subtitle = screen === 'workout-details'
    ? 'DETALHES DO DESAFIO'
    : screen === 'cardio-picker'
      ? ''
      : checkin
        ? 'CHECK-IN DE PRESENÇA'
        : screen === 'active'
          ? (session?.type === 'cardio' ? 'CARDIO EM ANDAMENTO' : 'TREINO EM ANDAMENTO')
          : complete
            ? 'TREINO CONCLUÍDO!'
            : 'DESAFIOS DO DIA';
  const workoutCompleted = completedChallengeIds.includes('workout');
  const cardioCompleted = completedChallengeIds.includes('cardio');
  const completedToday = [workoutCompleted, cardioCompleted].filter(Boolean).length;
  const awardedPoints = typeof completion?.pointsAwarded === 'number' && Number.isFinite(completion.pointsAwarded) && completion.pointsAwarded > 0
    ? completion.pointsAwarded
    : null;
  const completionPending = completion?.status === 'pending';
  const completionRejected = completion?.status === 'rejected';
  const competitiveSession = session?.competitionPolicy?.requiresSecurityReview === true;

  useEffect(() => {
    if (screen !== 'cardio-picker' || session || startingActivity || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') !== '1') return;
    if (startError && !/renovando|preparar|autoriz/i.test(startError)) return;
    if (autoStartAttempts.current >= 4) return;
    const timer = window.setTimeout(() => {
      autoStartAttempts.current += 1;
      onStart('cardio');
    }, autoStartAttempts.current === 0 ? 700 : 900);
    return () => window.clearTimeout(timer);
  }, [screen, session, startingActivity, startError, cardio.id, onStart]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (screen === 'cardio-picker' && !session) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('autostart')) return;
    url.searchParams.delete('autostart');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    autoStartAttempts.current = 0;
  }, [screen, session]);

  return createPortal(
    <main className={`challenge-flow-screen ${screen === 'active' && session?.type === 'cardio' && session?.requiresGpsDistance ? 'is-cardio-live' : ''} ${screen === 'active' && session?.type === 'workout' ? 'is-workout-live' : ''}`}>
      <header className="challenge-flow-header">
        <button aria-label="Voltar" onClick={onBack}>
          <ArrowLeft />
        </button>
        {subtitle ? <h1>{subtitle}</h1> : null}
      </header>

      {statusMessage ? <div role="status" className="challenge-flow-card"><p>{statusMessage}</p><Link to="/challenges/cardio/objective">ABRIR MEU OBJETIVO</Link></div> : null}

      {screen === 'workout-details' && (
        <section className="challenge-flow-card challenge-flow-details">
          <div className="challenge-flow-title">
            <span className="challenge-flow-icon"><Dumbbell /></span>
            <div>
              <small>{workoutCompleted ? 'CONCLUÍDO HOJE' : 'ATIVIDADE PRINCIPAL'}</small>
              <h2>TREINO DE MUSCULAÇÃO</h2>
              <b>Conta para XP e desafios</b>
            </div>
          </div>
          <p>Realize um treino completo e salve sua evolução. Se você estiver em ranking ou campeonato, somente a pontuação competitiva passará por verificação.</p>
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
            <p>{workoutCompleted ? 'Treino concluído hoje.' : 'Complete um treino de musculação hoje.'}</p>
          </div>
          <div className="challenge-flow-panel">
            <strong>REQUISITOS</strong>
            <ul>
              <li><MapPin />Check-in solicitado somente em atividade competitiva</li>
              <li><Clock3 />Cronômetro e exercícios registrados no aplicativo</li>
              <li><Timer />Dados de frequência quando houver sensor conectado</li>
            </ul>
          </div>
          <button
            className="challenge-flow-primary"
            onClick={() => onStart('workout')}
            disabled={startingActivity}
          >
            <Play />{startingActivity ? 'INICIANDO...' : workoutCompleted ? 'INICIAR OUTRO TREINO' : 'INICIAR TREINO'}
          </button>
        </section>
      )}

      {screen === 'cardio-picker' && (
        <section className="challenge-flow-card challenge-flow-cardio-picker" aria-label="Seleção de modalidade de cardio">
          <div className="challenge-flow-cardio-intro">
            <div className="challenge-flow-cardio-selected">
              <span className="challenge-flow-cardio-selected-icon">{icon(cardio.icon, 27)}</span>
              <div>
                <small>MODALIDADE SELECIONADA</small>
                <strong>{cardio.label.replace(' ao ar livre', '')}</strong>
                <span>{cardio.description}</span>
              </div>
            </div>
            <div className={`challenge-flow-cardio-tracking ${cardio.gps ? 'is-gps' : 'is-timer'}`}>
              {cardio.gps ? <Navigation /> : <Timer />}
              <span><b>{cardio.gps ? 'GPS + MAPA' : 'REGISTRO POR TEMPO'}</b><small>{cardio.gps ? 'Ative a localização' : 'Sem localização necessária'}</small></span>
            </div>
          </div>

          {(cardio.id === 'running' || cardio.id === 'walking') && onScoringChange ? (
            <ScoringModeToggle
              enabled={scoringEnabled}
              onChange={onScoringChange}
              disabled={startingActivity}
              onLabel="Se você estiver em ranking ou campeonato, o GPS contínuo será exigido para pontuar."
              offLabel="Atividade pessoal: salva distância, pace e histórico, mas não entra em ranking ou campeonato. O GPS deixa de ser obrigatório."
            />
          ) : null}

          <div className="challenge-flow-cardio-count"><span>ESCOLHA SUA MODALIDADE</span><b>4 DE {CARDIO_OPTIONS.length} OPÇÕES</b></div>
          <div className="challenge-flow-cardio-featured-grid">
            {featuredCardioOptions.map(item => (
              <button
                type="button"
                className={cardio.id === item.id ? 'is-selected' : ''}
                key={item.id}
                onClick={() => onCardio(item)}
                aria-pressed={cardio.id === item.id}
              >
                <span className="challenge-flow-cardio-option-icon">{icon(item.icon, 23)}</span>
                <span className="challenge-flow-cardio-option-copy"><strong>{item.label.replace(' ao ar livre', '')}</strong><small>{item.description}</small></span>
                <span className="challenge-flow-cardio-option-check" aria-hidden="true">{cardio.id === item.id ? <Check /> : null}</span>
              </button>
            ))}
          </div>

          <button type="button" className="challenge-flow-cardio-more" aria-expanded={showMoreCardio} onClick={() => setShowMoreCardio(value => !value)}>
            <span className="challenge-flow-cardio-more-dots" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/></span>
            <span><strong>MAIS 6 OPÇÕES</strong><small>{showMoreCardio ? 'Ocultar modalidades' : 'Elíptico, Remo, Escada, Natação e mais'}</small></span>
            <ChevronRight />
          </button>

          {showMoreCardio ? <div className="challenge-flow-cardio-extra-list">
            {extraCardioOptions.map(item => (
              <button type="button" className={cardio.id === item.id ? 'is-selected' : ''} key={item.id} onClick={() => { onCardio(item); setShowMoreCardio(false); }} aria-pressed={cardio.id === item.id}>
                <span className="challenge-flow-cardio-option-icon">{icon(item.icon, 21)}</span>
                <span className="challenge-flow-cardio-option-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                <span className="challenge-flow-cardio-option-check" aria-hidden="true">{cardio.id === item.id ? <Check /> : null}</span>
              </button>
            ))}
          </div> : null}

          <p className="challenge-flow-note"><MapPin /> O GPS é usado apenas nas modalidades ao ar livre. Você pode alterar sua escolha antes de iniciar.</p>

          <div className="challenge-flow-cardio-actions">
            {startError && (
              <div className="challenge-flow-end-error" role="alert" aria-live="assertive">
                <AlertCircle size={16} />
                <span>{startError}</span>
              </div>
            )}
            <button type="button" className="challenge-flow-primary" onClick={() => onStart('cardio')} disabled={startingActivity}>
              <Play />{startingActivity ? 'INICIANDO...' : 'INICIAR CARDIO'}
            </button>
            <Link to="/challenges/cardio/objective" className="challenge-flow-objective-link"><TargetGlyph />BUSCAR OBJETIVO</Link>
          </div>
        </section>
      )}

      {checkin && (
        <section className="challenge-flow-checkin">
          <p>{checkInRequired ? 'Você está inscrito em campeonato. O check-in presencial é obrigatório para validar sua pontuação.' : 'O check-in é opcional. Faça para registrar presença e participar das missões de frequência.'}</p>
          <div className="challenge-flow-radar"><MapPin /></div>
          <span>{startError ? 'Validação de presença não concluída.' : checkInRequired ? 'Campeonato ativo: presença obrigatória.' : 'Você também pode iniciar sem compartilhar a localização.'}</span>
          <article className={startError ? 'is-blocked' : ''}>
            <small>{startError ? 'LOCALIZAÇÃO NÃO VALIDADA' : 'PRONTO PARA VERIFICAR'}</small>
            <b>{gymName || 'Sua academia'}</b>
            <p>{startError || (checkInRequired ? 'Confirme sua presença para competir e pontuar.' : 'O check-in confirmado conta para missões e histórico presencial.')}</p>
            {startError ? <MapPin /> : <Check />}
          </article>
          <button className="challenge-flow-primary" onClick={() => onStart('workout', { checkIn: true })} disabled={startingActivity}>
            <Check />{startingActivity ? 'VALIDANDO...' : startError ? 'TENTAR NOVAMENTE' : 'FAZER CHECK-IN E INICIAR'}
          </button>
          {!checkInRequired && <button className="challenge-flow-secondary" onClick={() => onStart('workout', { checkIn: false })} disabled={startingActivity}>INICIAR SEM CHECK-IN</button>}
        </section>
      )}

      {screen === 'active' && session?.type === 'cardio' && session?.requiresGpsDistance && (
        <section className="challenge-cardio-live">
          <div className="challenge-cardio-live-topbar">
            <button type="button" onClick={onBack} aria-label="Minimizar atividade" title="Sair sem encerrar a atividade"><ChevronDown /></button>
            <div><InvictusLogo size={29} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div>
            <div className="challenge-cardio-live-menu-wrap">
              <button
                type="button"
                className="challenge-cardio-live-menu-trigger"
                aria-label="Opções da atividade"
                aria-expanded={cardioMenuOpen}
                onClick={() => {
                  setCardioMenuOpen(value => !value);
                  setConfirmDiscard(false);
                }}
              >
                <MoreVertical />
              </button>
              {cardioMenuOpen && (
                <div className="challenge-cardio-live-menu" role="menu" aria-label="Ações da atividade">
                  {!confirmDiscard ? (
                    <>
                      {onTogglePause && (
                        <button type="button" role="menuitem" onClick={() => { onTogglePause(); setCardioMenuOpen(false); }} disabled={loading}>
                          {session?.isPaused ? <Play /> : <Pause />}
                          <span>{session?.isPaused ? 'Retomar atividade' : 'Pausar atividade'}</span>
                        </button>
                      )}
                      <button type="button" role="menuitem" onClick={() => { setCardioMenuOpen(false); onEnd(); }} disabled={loading}>
                        <Flag />
                        <span>{loading ? 'Finalizando...' : 'Finalizar atividade'}</span>
                      </button>
                      {onCancel && (
                        <button type="button" role="menuitem" className="is-danger" onClick={() => setConfirmDiscard(true)}>
                          <XCircle />
                          <span>Descartar atividade</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="challenge-cardio-live-discard-confirm">
                      <strong>Descartar atividade?</strong>
                      <small>O registro desta sessão será perdido.</small>
                      <div>
                        <button type="button" onClick={() => setConfirmDiscard(false)}>Cancelar</button>
                        <button type="button" className="is-danger" onClick={() => { setCardioMenuOpen(false); setConfirmDiscard(false); onCancel?.(); }}>Descartar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <LiveTrackingMap
            points={(liveCheckpoints || []).map(cp => ({ lat: cp.location.lat, lng: cp.location.lng, accuracy: cp.location.accuracy }))}
            gpsAccuracy={gpsAccuracy}
            gpsSignal={gpsSignal}
            permissionDenied={gpsPermissionDenied}
            stalled={gpsStalled}
            onRetry={onRetryGps}
            heightPx={Math.max(280, Math.min(500, typeof window !== 'undefined' ? window.innerHeight * .56 : 430))}
          />

          <div className="challenge-cardio-live-content">
            <article className="challenge-cardio-live-stats">
              <header>
                <span>{icon(cardio.icon, 24)}</span>
                <strong>{activeTitle}</strong>
                {competitiveSession ? <ShieldCheck /> : <Check />}
              </header>
              <div className="challenge-cardio-live-metrics">
                <article><Clock3 /><b>{time(elapsed)}</b><small>Tempo</small></article>
                <article><Navigation /><b>{distance.toFixed(2)}</b><small>Distância (km)</small></article>
                <article><Gauge /><b>{currentSpeedLabel}</b><small>Velocidade atual (km/h)</small></article>
                <article><Timer /><b>{currentPaceLabel}</b><small>Pace atual (min/km)</small></article>
              </div>
            </article>

            <div className="challenge-cardio-live-status">
              {competitiveSession ? <ShieldCheck /> : <Check />}
              <span><b>{session?.isPaused ? 'ATIVIDADE PAUSADA' : competitiveSession ? 'ATIVIDADE COMPETITIVA' : 'ATIVIDADE SENDO REGISTRADA'}</b><small>{gpsPermissionDenied ? 'Localização desativada' : gpsStalled ? 'Sinal de GPS indisponível' : gpsSignal === 'SEARCHING' ? 'Buscando sinal GPS' : gpsSignal === 'WEAK' ? 'GPS com precisão moderada' : 'GPS conectado'}</small></span>
            </div>

            {endError && <div className="challenge-flow-end-error"><AlertCircle size={16} /><span>{endError}</span></div>}
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
          <div className="challenge-flow-activity-type" aria-label={`Atividade atual: ${activeTitle}`}>
            {activeTitle}
          </div>
          <span className="challenge-flow-gps">
            <Zap /> {session?.isPaused ? 'EM PAUSA' : session?.requiresGpsDistance ? 'GPS CONECTADO' : (session?.type === 'cardio' ? 'CARDIO INDOOR' : 'ATIVIDADE EM ANDAMENTO')}
          </span>
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
                stalled={gpsStalled}
                onRetry={onRetryGps}
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
                  <article><b>{currentSpeedLabel}</b><span>Velocidade atual (km/h)</span></article>
                  <article><b>{currentPaceLabel}</b><span>Pace atual (min/km)</span></article>
                  <article><b>{averagePace}</b><span>Pace médio (min/km)</span></article>
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
          <p>Atividade concluída e salva no seu histórico.</p>
          {awardedPoints !== null ? (
            <strong>+{awardedPoints} XP <Zap /></strong>
          ) : (
            <strong className="text-[15px]">Atividade salva no histórico</strong>
          )}
          {completionPending ? <small>{completion?.message || 'Pontuação competitiva em análise'}</small> : null}
          {completionRejected ? <small>{completion?.message || 'Fora da pontuação competitiva'}</small> : null}
          {completion?.status === 'approved' ? <small>Pontuação competitiva validada</small> : null}
          {completion?.status === 'recorded' ? <small>Já conta para seus desafios e missões</small> : null}
          <article>
            <b>TREINO DE MUSCULAÇÃO</b>
            <small>1/1</small>
            <div />
          </article>
          <button className="challenge-flow-primary" onClick={onSummary}>
            VER DESAFIOS DO DIA
          </button>
          <button className="challenge-flow-secondary" onClick={onDone}>
            VOLTAR PARA DESAFIOS
          </button>
        </section>
      )}

      {screen === 'day-progress' && (
        <section className="challenge-flow-day-progress">
          <p>Progresso dos desafios concluídos hoje</p>
          <strong>{completedToday}/2</strong>
          <div className="challenge-flow-day-track">
            <i style={{ width: `${Math.min(100, completedToday * 50)}%` }} />
          </div>
          <article>
            <span className={workoutCompleted ? 'is-complete' : ''}><Check /></span>
            <b>TREINO DE MUSCULAÇÃO</b>
            <em>{workoutCompleted ? 'CONCLUÍDO' : 'PENDENTE'}</em>
          </article>
          <article>
            <span className={cardioCompleted ? 'is-complete' : ''}><Check /></span>
            <b>CARDIO AERÓBICO</b>
            <em>{cardioCompleted ? 'CONCLUÍDO' : 'PENDENTE'}</em>
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

function TargetGlyph() {
  return <span className="challenge-flow-target-glyph" aria-hidden="true"><i/><b/></span>;
}
