from pathlib import Path
import re

def replace_once(path_str: str, old: str, new: str):
    path = Path(path_str)
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path_str}: expected 1 match, found {count}: {old[:120]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

def regex_replace_once(path_str: str, pattern: str, replacement: str):
    path = Path(path_str)
    text = path.read_text(encoding='utf-8')
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{path_str}: expected 1 regex match, found {count}: {pattern[:120]!r}')
    path.write_text(new_text, encoding='utf-8')

# -----------------------------------------------------------------
# 1) Server-side personal/competitive session choice.
# -----------------------------------------------------------------
replace_once(
    'api/_lib/activity-competition-policy.ts',
    "  isIndoorCardio?: boolean;\n  when?: Date;\n}",
    "  isIndoorCardio?: boolean;\n  /** Escolha explícita do atleta no início da sessão. 'personal' nunca cria contexto competitivo. */\n  requestedMode?: 'competitive' | 'personal';\n  when?: Date;\n}"
)
replace_once(
    'api/_lib/activity-competition-policy.ts',
    "  const isSupportedActivity = activityType === 'workout' || activityType === 'cardio';\n  if (!db || !isSupportedActivity) return finalizePolicy(input, when, []);",
    "  const isSupportedActivity = activityType === 'workout' || activityType === 'cardio';\n  // A escolha pessoal é soberana para ESTA sessão: mesmo que o usuário esteja\n  // inscrito em ranking/campeonato, nenhum contexto competitivo é anexado.\n  // A decisão fica congelada no snapshot do servidor; desligar GPS só no\n  // cliente nunca seria suficiente para proteger a pontuação.\n  if (input.requestedMode === 'personal') return finalizePolicy(input, when, []);\n  if (!db || !isSupportedActivity) return finalizePolicy(input, when, []);"
)
replace_once(
    'api/_lib/activity-competition-policy.ts',
    "    isIndoorCardio: modality.isIndoorCardio,\n    policy: frozenPolicy,",
    "    isIndoorCardio: modality.isIndoorCardio,\n    requestedMode: normalizedInput.requestedMode || 'competitive',\n    policy: frozenPolicy,"
)

replace_once(
    'api/_handlers/activity-policy.ts',
    "  if (!db) return res.status(503).json({ error: 'Banco de dados indisponível.' });\n\n  let modality;",
    "  if (!db) return res.status(503).json({ error: 'Banco de dados indisponível.' });\n\n  const requestedMode = req.body?.requestedMode == null || req.body?.requestedMode === 'competitive'\n    ? 'competitive' as const\n    : req.body?.requestedMode === 'personal'\n      ? 'personal' as const\n      : null;\n  if (!requestedMode) return res.status(400).json({ error: 'Modo da atividade inválido.' });\n\n  let modality;"
)
replace_once(
    'api/_handlers/activity-policy.ts',
    "    isIndoorCardio: modality.isIndoorCardio,\n    when,",
    "    isIndoorCardio: modality.isIndoorCardio,\n    requestedMode,\n    when,"
)

# -----------------------------------------------------------------
# 2) Client service: mode travels to server and check-in errors keep
#    the structured reason for the new fallback card.
# -----------------------------------------------------------------
replace_once(
    'src/services/activityService.ts',
    "    const result = await response.json().catch(() => ({}));\n    if (!response.ok || !result.checkInId) throw new Error(result.error || 'Não foi possível confirmar o check-in presencial.');\n    return { checkInId: result.checkInId, location, gymName: result.gymName };",
    "    const result = await response.json().catch(() => ({}));\n    if (!response.ok || !result.checkInId) {\n      const error = new Error(result.error || 'Não foi possível confirmar o check-in presencial.') as Error & {\n        status?: string; distanceMeters?: number; gpsAccuracy?: number;\n      };\n      error.status = typeof result.status === 'string' ? result.status : undefined;\n      error.distanceMeters = Number.isFinite(Number(result.distanceMeters)) ? Number(result.distanceMeters) : undefined;\n      error.gpsAccuracy = Number.isFinite(Number(result.gpsAccuracy)) ? Number(result.gpsAccuracy) : undefined;\n      throw error;\n    }\n    return { checkInId: result.checkInId, location, gymName: result.gymName };"
)
replace_once(
    'src/services/activityService.ts',
    "  async resolveCompetitionPolicy(type: 'workout' | 'cardio', cardioType?: string): Promise<ActivityCompetitionPolicy> {",
    "  async resolveCompetitionPolicy(type: 'workout' | 'cardio', cardioType?: string, requestedMode: 'competitive' | 'personal' = 'competitive'): Promise<ActivityCompetitionPolicy> {"
)
replace_once(
    'src/services/activityService.ts',
    "        isIndoorCardio: cardioConfig ? cardioConfig.category !== 'outdoor' : false,\n      }),",
    "        isIndoorCardio: cardioConfig ? cardioConfig.category !== 'outdoor' : false,\n        requestedMode,\n      }),"
)

# -----------------------------------------------------------------
# 3) Musculação UX: explicit scoring switch + continue personally
#    when competitive check-in cannot be confirmed.
# -----------------------------------------------------------------
replace_once(
    'src/pages/Musculation.tsx',
    "  ArrowLeft, ArrowRight, Brain, CalendarDays, Check, ChevronRight, Clock3,\n  Dumbbell, Info, ListFilter, Pencil, Play, Plus,",
    "  ArrowLeft, ArrowRight, Brain, CalendarDays, Check, ChevronRight, Clock3,\n  Dumbbell, Info, ListFilter, MapPin, Pencil, Play, Plus,"
)
replace_once(
    'src/pages/Musculation.tsx',
    "const MIN_PLAN_COMMITMENT_DAYS = 30;",
    "const MIN_PLAN_COMMITMENT_DAYS = 30;\nconst WORKOUT_SCORING_PREF_KEY = 'invictus:workout-scoring-enabled';"
)
replace_once(
    'src/pages/Musculation.tsx',
    "  const [policyLoading, setPolicyLoading] = useState(false);\n  const [pendingNewPlanFlow, setPendingNewPlanFlow] = useState<'manual' | 'ai' | null>(null);",
    "  const [policyLoading, setPolicyLoading] = useState(false);\n  const [pendingNewPlanFlow, setPendingNewPlanFlow] = useState<'manual' | 'ai' | null>(null);\n  const [scoringEnabled, setScoringEnabled] = useState(() => typeof window === 'undefined' || window.localStorage.getItem(WORKOUT_SCORING_PREF_KEY) !== 'false');\n  const [checkInIssue, setCheckInIssue] = useState<{ message: string; plan: WorkoutPlan; workout: PlannedWorkout } | null>(null);"
)
replace_once(
    'src/pages/Musculation.tsx',
    "  useEffect(() => {\n    if (!user?.uid) return;\n    let active = true;\n    setPolicyLoading(true);\n    activityService.resolveCompetitionPolicy('workout')\n      .then((policy) => { if (active) setStartPolicy(policy); })\n      .catch((reason) => { if (active) setError(reason.message || 'Não foi possível preparar o início do treino.'); })\n      .finally(() => { if (active) setPolicyLoading(false); });\n    return () => { active = false; };\n  }, [user?.uid]);",
    "  useEffect(() => {\n    if (!user?.uid) return;\n    let active = true;\n    setStartPolicy(null);\n    setPolicyLoading(true);\n    activityService.resolveCompetitionPolicy('workout', undefined, scoringEnabled ? 'competitive' : 'personal')\n      .then((policy) => { if (active) setStartPolicy(policy); })\n      .catch((reason) => { if (active) setError(reason.message || 'Não foi possível preparar o início do treino.'); })\n      .finally(() => { if (active) setPolicyLoading(false); });\n    return () => { active = false; };\n  }, [user?.uid, scoringEnabled]);"
)
replace_once(
    'src/pages/Musculation.tsx',
    "  const activePlan = selectedPlan || plans.find(plan => plan.status === 'active') || null;",
    "  const selectScoringMode = (enabled: boolean) => {\n    setScoringEnabled(enabled);\n    setStartPolicy(null);\n    setCheckInIssue(null);\n    try { window.localStorage.setItem(WORKOUT_SCORING_PREF_KEY, enabled ? 'true' : 'false'); } catch {}\n  };\n\n  const activePlan = selectedPlan || plans.find(plan => plan.status === 'active') || null;"
)

old_start = """  const startWorkout = async (plan: WorkoutPlan, workout: PlannedWorkout) => {
    const policy = startPolicy;
    if (!policy || Date.parse(policy.startBy) < Date.now()) {
      setPolicyLoading(true);
      setError('Estamos renovando a autorização do treino. Quando a mensagem sumir, toque em iniciar novamente.');
      try {
        setStartPolicy(await activityService.resolveCompetitionPolicy('workout'));
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Não foi possível preparar o treino.');
      } finally {
        setPolicyLoading(false);
      }
      return;
    }
    const motionPermission = policy.requiresMotionSensors
      ? activityService.requestMotionPermission()
      : Promise.resolve('granted' as const);
    setLoading(true); setError(null);
    try {
      await motionPermission;
      const checkIn = policy.requiresGymCheckIn
        ? await activityService.performGymCheckIn(policy)
        : undefined;
      await activityService.startSession('workout', checkIn?.location, undefined, undefined, checkIn?.checkInId, workout.focus || 'Musculação', {
        workoutPlanId: plan.id, workoutId: workout.id, plannedExercises: workout.exercises
      }, policy);
      navigate('/challenges', { replace: true });
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };
"""
new_start = """  const startWorkout = async (plan: WorkoutPlan, workout: PlannedWorkout) => {
    const requestedMode = scoringEnabled ? 'competitive' : 'personal';
    const policy = startPolicy;
    if (!policy || !policy.startBy || Date.parse(policy.startBy) < Date.now()) {
      setPolicyLoading(true);
      setError('Estamos renovando a autorização do treino. Quando a mensagem sumir, toque em iniciar novamente.');
      try {
        setStartPolicy(await activityService.resolveCompetitionPolicy('workout', undefined, requestedMode));
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Não foi possível preparar o treino.');
      } finally {
        setPolicyLoading(false);
      }
      return;
    }
    setLoading(true); setError(null); setCheckInIssue(null);
    try {
      if (policy.requiresMotionSensors) await activityService.requestMotionPermission();
      let checkIn: Awaited<ReturnType<typeof activityService.performGymCheckIn>> | undefined;
      if (policy.requiresGymCheckIn) {
        try {
          checkIn = await activityService.performGymCheckIn(policy);
        } catch (err: any) {
          setCheckInIssue({ message: err?.message || 'Não foi possível confirmar sua presença na academia.', plan, workout });
          return;
        }
      }
      await activityService.startSession('workout', checkIn?.location, undefined, undefined, checkIn?.checkInId, workout.focus || 'Musculação', {
        workoutPlanId: plan.id, workoutId: workout.id, plannedExercises: workout.exercises
      }, policy);
      navigate('/challenges', { replace: true });
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const continueWithoutScoring = async () => {
    const pending = checkInIssue;
    if (!pending) return;
    setLoading(true); setPolicyLoading(true); setError(null);
    try {
      const personalPolicy = await activityService.resolveCompetitionPolicy('workout', undefined, 'personal');
      try { window.localStorage.setItem(WORKOUT_SCORING_PREF_KEY, 'false'); } catch {}
      setScoringEnabled(false);
      setStartPolicy(personalPolicy);
      setCheckInIssue(null);
      await activityService.startSession('workout', undefined, undefined, undefined, undefined, pending.workout.focus || 'Musculação', {
        workoutPlanId: pending.plan.id, workoutId: pending.workout.id, plannedExercises: pending.workout.exercises
      }, personalPolicy);
      navigate('/challenges', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Não foi possível iniciar o treino pessoal.');
    } finally {
      setPolicyLoading(false); setLoading(false);
    }
  };

  const retryCompetitiveCheckIn = () => {
    const pending = checkInIssue;
    if (!pending) return;
    setCheckInIssue(null);
    void startWorkout(pending.plan, pending.workout);
  };
"""
replace_once('src/pages/Musculation.tsx', old_start, new_start)

replace_once(
    'src/pages/Musculation.tsx',
    "{view === 'hub' ? <Hub userName={user?.displayName || user?.name || 'Atleta'} plan={activePlan} today={todayWorkout} loading={loading || policyLoading} planLocked={activePlanLocked} planDaysRemaining={activePlanDaysRemaining} onManual={() => startNewPlanFlow('manual')} onAi={() => startNewPlanFlow('ai')} onPlan={() => setView('plan')} onWorkout={(workout) => { setSelectedWorkout(workout); setView('workout'); }} onStart={() => activePlan && todayWorkout && startWorkout(activePlan, todayWorkout)} /> : null}",
    "{view === 'hub' ? <Hub userName={user?.displayName || user?.name || 'Atleta'} plan={activePlan} today={todayWorkout} loading={loading || policyLoading} planLocked={activePlanLocked} planDaysRemaining={activePlanDaysRemaining} scoringEnabled={scoringEnabled} onScoringChange={selectScoringMode} onManual={() => startNewPlanFlow('manual')} onAi={() => startNewPlanFlow('ai')} onPlan={() => setView('plan')} onWorkout={(workout) => { setSelectedWorkout(workout); setView('workout'); }} onStart={() => activePlan && todayWorkout && startWorkout(activePlan, todayWorkout)} /> : null}"
)
replace_once(
    'src/pages/Musculation.tsx',
    "{view === 'workout' && activePlan && selectedWorkout ? <WorkoutView plan={activePlan} workout={selectedWorkout} onBack={() => setView('plan')} onStart={() => startWorkout(activePlan, selectedWorkout)} loading={loading || policyLoading} /> : null}",
    "{view === 'workout' && activePlan && selectedWorkout ? <WorkoutView plan={activePlan} workout={selectedWorkout} onBack={() => setView('plan')} onStart={() => startWorkout(activePlan, selectedWorkout)} loading={loading || policyLoading} scoringEnabled={scoringEnabled} onScoringChange={selectScoringMode} /> : null}"
)
replace_once(
    'src/pages/Musculation.tsx',
    "    {error ? <div className=\"mus-error\" role=\"alert\">{error}<button onClick={() => setError(null)}>Fechar</button></div> : null}\n    {showInfo ?",
    "    {error ? <div className=\"mus-error\" role=\"alert\">{error}<button onClick={() => setError(null)}>Fechar</button></div> : null}\n    {checkInIssue ? <div className=\"mus-info-overlay mus-checkin-fallback\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"mus-checkin-title\"><section><MapPin /><h2 id=\"mus-checkin-title\">CHECK-IN COMPETITIVO NÃO CONFIRMADO</h2><p>{checkInIssue.message}</p><small>Você pode tentar o check-in novamente ou registrar este treino normalmente sem pontuação. No modo pessoal não usamos a localização da academia e o treino continua no seu histórico, volume, progressão e Saúde.</small><button onClick={retryCompetitiveCheckIn}>TENTAR CHECK-IN NOVAMENTE</button><button className=\"is-back\" onClick={continueWithoutScoring}>CONTINUAR SEM PONTUAR</button></section></div> : null}\n    {showInfo ?"
)

insert_before_hub = """function ScoringModeControl({ enabled, onChange, disabled = false }: { enabled: boolean; onChange: (enabled: boolean) => void; disabled?: boolean }) {
  return <div className={`mus-scoring-mode ${enabled ? 'is-scoring' : 'is-personal'}`}>
    <div><Trophy /><span><b>{enabled ? 'PONTUAÇÃO ATIVADA' : 'TREINO PESSOAL'}</b><small>{enabled ? 'Check-in e antifraude serão usados quando a disputa exigir.' : 'Sem GPS de academia e sem pontos. O treino continua sendo registrado.'}</small></span></div>
    <div className="mus-scoring-options" role="group" aria-label="Modo do treino">
      <button type="button" className={enabled ? 'is-selected' : ''} onClick={() => onChange(true)} disabled={disabled}>PONTUAR</button>
      <button type="button" className={!enabled ? 'is-selected' : ''} onClick={() => onChange(false)} disabled={disabled}>PESSOAL</button>
    </div>
  </div>;
}

"""
replace_once('src/pages/Musculation.tsx', "function Hub({ userName, plan, today, loading, planLocked, planDaysRemaining, onManual, onAi, onPlan, onWorkout, onStart }: any) {", insert_before_hub + "function Hub({ userName, plan, today, loading, planLocked, planDaysRemaining, scoringEnabled, onScoringChange, onManual, onAi, onPlan, onWorkout, onStart }: any) {")
replace_once(
    'src/pages/Musculation.tsx',
    "<div><h3>{today.focus || today.name}</h3><span>{today.name}</span><p><Dumbbell /> {today.exercises.length} exercícios</p><p><Clock3 /> ~{plan.durationMinutes} min</p><button onClick={onStart} disabled={loading}><Play />{loading ? 'INICIANDO…' : 'INICIAR TREINO'}</button></div>",
    "<div><h3>{today.focus || today.name}</h3><span>{today.name}</span><p><Dumbbell /> {today.exercises.length} exercícios</p><p><Clock3 /> ~{plan.durationMinutes} min</p><ScoringModeControl enabled={scoringEnabled} onChange={onScoringChange} disabled={loading} /><button onClick={onStart} disabled={loading}><Play />{loading ? 'INICIANDO…' : 'INICIAR TREINO'}</button></div>"
)
replace_once(
    'src/pages/Musculation.tsx',
    "function WorkoutView({ workout, onBack, onStart, loading }: { plan: WorkoutPlan; workout: PlannedWorkout; onBack: () => void; onStart: () => void; loading: boolean }) {\n  return <><Header onBack={onBack} /><section className=\"mus-flow\"><h1>{workout.name}</h1><p>{workout.focus}</p><div className=\"mus-workout-detail\">{workout.exercises.map((item,index) => { const exercise = OFFICIAL_EXERCISE_BY_ID.get(item.exerciseId); return <article key={`${item.exerciseId}-${index}`}><OfficialExerciseMedia exercise={exercise} label={item.exerciseId} className=\"mus-detail-media\" /><i>{index+1}</i><span><b>{exercise?.name || item.exerciseId}</b><small>{item.sets} × {item.repsMin}–{item.repsMax} · {item.restSeconds}s descanso{item.targetRir !== undefined ? ` · RIR ${item.targetRir}` : ''}{item.initialLoadKg !== undefined ? ` · ${item.initialLoadKg} kg inicial` : ''}</small></span></article>; })}</div><button className=\"mus-start-workout\" onClick={onStart} disabled={loading}><Play />{loading ? 'INICIANDO…' : 'INICIAR TREINO'}</button></section></>;\n}",
    "function WorkoutView({ workout, onBack, onStart, loading, scoringEnabled, onScoringChange }: { plan: WorkoutPlan; workout: PlannedWorkout; onBack: () => void; onStart: () => void; loading: boolean; scoringEnabled: boolean; onScoringChange: (enabled: boolean) => void }) {\n  return <><Header onBack={onBack} /><section className=\"mus-flow\"><h1>{workout.name}</h1><p>{workout.focus}</p><div className=\"mus-workout-detail\">{workout.exercises.map((item,index) => { const exercise = OFFICIAL_EXERCISE_BY_ID.get(item.exerciseId); return <article key={`${item.exerciseId}-${index}`}><OfficialExerciseMedia exercise={exercise} label={item.exerciseId} className=\"mus-detail-media\" /><i>{index+1}</i><span><b>{exercise?.name || item.exerciseId}</b><small>{item.sets} × {item.repsMin}–{item.repsMax} · {item.restSeconds}s descanso{item.targetRir !== undefined ? ` · RIR ${item.targetRir}` : ''}{item.initialLoadKg !== undefined ? ` · ${item.initialLoadKg} kg inicial` : ''}</small></span></article>; })}</div><ScoringModeControl enabled={scoringEnabled} onChange={onScoringChange} disabled={loading} /><button className=\"mus-start-workout\" onClick={onStart} disabled={loading}><Play />{loading ? 'INICIANDO…' : 'INICIAR TREINO'}</button></section></>;\n}"
)

mus_css = Path('src/pages/Musculation.css')
css_text = mus_css.read_text(encoding='utf-8')
marker = '/* personal-workout-scoring-v1 */'
if marker not in css_text:
    css_text += """

/* personal-workout-scoring-v1 */
.mus-scoring-mode{grid-column:1/-1;margin:10px 0 4px;padding:10px;border:1px solid #3c3c3c;border-radius:9px;background:#090909}.mus-today-card .mus-scoring-mode{margin-top:9px}.mus-scoring-mode>div:first-child{display:flex;align-items:flex-start;gap:8px}.mus-scoring-mode>div:first-child>svg{flex:0 0 18px;width:18px;margin-top:1px;color:#f5b514}.mus-scoring-mode>div:first-child>span{display:grid;gap:2px}.mus-scoring-mode>div:first-child b{color:#f5b514;font-size:11px;letter-spacing:.04em}.mus-scoring-mode>div:first-child small{color:#aaa;font-size:10px;line-height:1.35}.mus-scoring-mode.is-personal{border-color:#3b4650}.mus-scoring-mode.is-personal>div:first-child>svg,.mus-scoring-mode.is-personal>div:first-child b{color:#d8dde2}.mus-scoring-options{display:grid!important;grid-template-columns:1fr 1fr;gap:5px!important;margin-top:8px}.mus-scoring-options>button,.mus-today-card .mus-scoring-options>button{min-height:32px!important;margin:0!important;border:1px solid #343434!important;border-radius:6px!important;color:#aaa!important;background:#111!important;font-size:10px!important;font-weight:700!important}.mus-scoring-options>button.is-selected,.mus-today-card .mus-scoring-options>button.is-selected{border-color:#d89d00!important;color:#171107!important;background:#f3b517!important}.mus-scoring-mode.is-personal .mus-scoring-options>button.is-selected{border-color:#777!important;color:#fff!important;background:#343a40!important}.mus-checkin-fallback section>small{display:block;margin:-4px 0 14px;color:#aaa;font-size:12px;line-height:1.45}.mus-checkin-fallback section>svg{color:#f5b514}.mus-checkin-fallback section .is-back{margin-top:8px;border:1px solid #777!important;color:#f4f4f4!important;background:#171717!important}
"""
    mus_css.write_text(css_text, encoding='utf-8')

# -----------------------------------------------------------------
# 4) Daily active-energy consolidation. Health daily total is
#    authoritative when present; workout calories are never added a
#    second time. Without a Health calorie total, estimate only the
#    non-workout steps and add the workout calories.
# -----------------------------------------------------------------
Path('api/_lib/active-energy-summary.ts').write_text(r'''export type ActiveEnergySource = 'apple_health' | 'health_connect' | 'strava' | 'invictus_manual' | 'invictus_gps';

export interface ActiveEnergySample {
  value: number;
  timestamp: string;
  localDate: string;
  source: ActiveEnergySource;
  aggregation?: 'daily_total' | 'sleep_session' | 'sample';
  sourceActivityId?: string;
}

export interface DailyActiveEnergyPoint {
  localDate: string;
  timestamp: string;
  totalCalories: number;
  movementCalories: number;
  workoutCalories: number;
  steps: number;
  workoutSteps: number;
  source: ActiveEnergySource;
  quality: 'measured' | 'mixed' | 'estimated';
  usedHealthDailyTotal: boolean;
}

const SOURCE_PRIORITY: Record<ActiveEnergySource, number> = {
  apple_health: 100,
  health_connect: 90,
  strava: 70,
  invictus_gps: 60,
  invictus_manual: 10,
};

function finitePositive(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function bestSample(samples: ActiveEnergySample[]): ActiveEnergySample | undefined {
  return [...samples].sort((a, b) => {
    const priority = (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0);
    return priority || b.timestamp.localeCompare(a.timestamp);
  })[0];
}

export function estimateMovementCaloriesFromSteps(steps: number, weightKg: number): number {
  const safeSteps = Math.max(0, Math.round(Number(steps) || 0));
  const safeWeight = Math.min(250, Math.max(35, Number(weightKg) || 70));
  // Fallback conservador para caminhada cotidiana: ~0,04 kcal/passo em 70 kg,
  // escalado pelo peso. Só é usado quando Apple Health/Health Connect NÃO
  // entregam um total diário de calorias ativas.
  return Math.round(safeSteps * 0.04 * (safeWeight / 70));
}

export function buildDailyActiveEnergy(input: {
  calorieSamples: ActiveEnergySample[];
  stepsDailySamples: ActiveEnergySample[];
  stepsActivitySamples: ActiveEnergySample[];
  weightKg: number;
}): DailyActiveEnergyPoint[] {
  const days = new Set<string>();
  for (const sample of [...input.calorieSamples, ...input.stepsDailySamples, ...input.stepsActivitySamples]) {
    if (sample.localDate) days.add(sample.localDate);
  }

  const output: DailyActiveEnergyPoint[] = [];
  for (const localDate of [...days].sort()) {
    const calories = input.calorieSamples.filter((sample) => sample.localDate === localDate && Number.isFinite(Number(sample.value)) && Number(sample.value) >= 0);
    const dailyTotals = calories.filter((sample) => sample.aggregation === 'daily_total' && !sample.sourceActivityId);
    const workoutCaloriesSamples = calories.filter((sample) => Boolean(sample.sourceActivityId) && finitePositive(sample.value) > 0);
    const workoutCaloriesRaw = Math.round(workoutCaloriesSamples.reduce((sum, sample) => sum + finitePositive(sample.value), 0));

    const dailyStepsSample = bestSample(input.stepsDailySamples.filter((sample) => sample.localDate === localDate && Number.isFinite(Number(sample.value)) && Number(sample.value) >= 0));
    const dailySteps = Math.max(0, Math.round(Number(dailyStepsSample?.value) || 0));
    const workoutSteps = Math.max(0, Math.round(input.stepsActivitySamples
      .filter((sample) => sample.localDate === localDate)
      .reduce((sum, sample) => sum + finitePositive(sample.value), 0)));

    const authoritative = bestSample(dailyTotals);
    if (authoritative && (Number(authoritative.value) > 0 || workoutCaloriesRaw === 0)) {
      const healthTotal = Math.max(0, Math.round(Number(authoritative.value) || 0));
      const totalCalories = Math.max(healthTotal, workoutCaloriesRaw);
      const workoutCalories = Math.min(workoutCaloriesRaw, totalCalories);
      output.push({
        localDate,
        timestamp: authoritative.timestamp,
        totalCalories,
        movementCalories: Math.max(0, totalCalories - workoutCalories),
        workoutCalories,
        steps: dailySteps,
        workoutSteps,
        source: authoritative.source,
        quality: workoutCaloriesRaw > healthTotal ? 'mixed' : 'measured',
        usedHealthDailyTotal: true,
      });
      continue;
    }

    const nonWorkoutSteps = Math.max(0, dailySteps - workoutSteps);
    const movementCalories = estimateMovementCaloriesFromSteps(nonWorkoutSteps, input.weightKg);
    const workoutCalories = workoutCaloriesRaw;
    const totalCalories = movementCalories + workoutCalories;
    const measuredWorkoutCalories = workoutCaloriesSamples.some((sample) => ['apple_health', 'health_connect', 'strava'].includes(sample.source));
    const estimatedWorkoutCalories = workoutCaloriesSamples.some((sample) => ['invictus_manual', 'invictus_gps'].includes(sample.source));
    const source = dailyStepsSample?.source || bestSample(workoutCaloriesSamples)?.source || 'invictus_manual';
    const timestamp = [dailyStepsSample?.timestamp, ...workoutCaloriesSamples.map((sample) => sample.timestamp)].filter(Boolean).sort().at(-1) || `${localDate}T12:00:00.000Z`;

    if (totalCalories > 0 || dailyStepsSample) {
      output.push({
        localDate,
        timestamp,
        totalCalories,
        movementCalories,
        workoutCalories,
        steps: dailySteps,
        workoutSteps,
        source,
        quality: movementCalories > 0 || estimatedWorkoutCalories ? (measuredWorkoutCalories ? 'mixed' : 'estimated') : 'measured',
        usedHealthDailyTotal: false,
      });
    }
  }
  return output;
}
''', encoding='utf-8')

replace_once(
    'api/_handlers/health-summary.ts',
    "import { cors, verifyAuth } from '../_lib/common.js';",
    "import { cors, db, verifyAuth } from '../_lib/common.js';"
)
replace_once(
    'api/_handlers/health-summary.ts',
    "import { aggregateDailyHealthSamples, healthSampleLocalDate } from '../_lib/health-source-priority.js';",
    "import { aggregateDailyHealthSamples, healthSampleLocalDate } from '../_lib/health-source-priority.js';\nimport { buildDailyActiveEnergy, type DailyActiveEnergyPoint } from '../_lib/active-energy-summary.js';"
)
replace_once(
    'api/_handlers/health-summary.ts',
    "  trends: Partial<Record<HealthMetricType, SummaryPoint[]>>;\n  metadata:",
    "  trends: Partial<Record<HealthMetricType, SummaryPoint[]>>;\n  activeEnergy?: { latest: DailyActiveEnergyPoint | null; trends: DailyActiveEnergyPoint[] };\n  metadata:"
)
health_marker = """  return result;
}

export default async function handler"""
health_insert = r'''  // Consolida energia ativa sem dupla contagem. Um total diário vindo do
  // Apple Health/Health Connect já pode incluir o treino; nesse caso ele é
  // soberano. Se o Health só trouxe passos, estimamos apenas os passos FORA
  // dos treinos e somamos as calorias das sessões registradas.
  try {
    const [calorieSeries, stepsDailySeries, stepsActivitySeries] = await Promise.all([
      lerSerieTemporalMetricaComLimite(userId, 'calories_active', since, now, LIMIT_PER_METRIC, timeZone),
      lerSerieTemporalMetricaComLimite(userId, 'steps_daily', since, now, LIMIT_PER_METRIC, timeZone),
      lerSerieTemporalMetricaComLimite(userId, 'steps_activity', since, now, LIMIT_PER_METRIC, timeZone),
    ]);
    let weightKg = 70;
    try {
      if (db) {
        const profile = (await db.collection('users').doc(userId).get()).data() || {};
        const profileWeight = Number(profile.weight ?? profile.weightKg);
        if (Number.isFinite(profileWeight) && profileWeight > 0) weightKg = profileWeight;
      }
    } catch { /* fallback determinístico de 70 kg */ }

    const simplify = (sample: HealthSample) => ({
      value: Number(sample.value),
      timestamp: sample.updatedAt || sample.createdAt || sample.timestamp,
      localDate: healthSampleLocalDate(sample, timeZone),
      source: sample.source,
      aggregation: sample.aggregation,
      sourceActivityId: sample.sourceActivityId,
    });
    const activeEnergy = buildDailyActiveEnergy({
      calorieSamples: calorieSeries.samples.map(simplify),
      stepsDailySamples: stepsDailySeries.samples.map(simplify),
      stepsActivitySamples: stepsActivitySeries.samples.map(simplify),
      weightKg,
    }).filter((entry) => entry.localDate >= trendStartDate && entry.localDate <= today);

    result.activeEnergy = { latest: activeEnergy.at(-1) || null, trends: activeEnergy };
    if (activeEnergy.length) {
      const asSummaryPoint = (entry: DailyActiveEnergyPoint): SummaryPoint => ({
        value: entry.totalCalories,
        unit: 'kcal',
        timestamp: entry.timestamp,
        sampleId: `active-energy:v1:${entry.localDate}`,
        source: entry.source,
        localDate: entry.localDate,
        sampleCount: 1,
        aggregationMethod: 'daily_total',
      });
      result.trends.calories_active = activeEnergy.map(asSummaryPoint);
      result.latest.calories_active = asSummaryPoint(activeEnergy[activeEnergy.length - 1]);
    }
  } catch {
    // A composição é enriquecimento da área Saúde e jamais pode apagar as
    // demais métricas quando uma leitura auxiliar falha.
    result.metadata.partial = true;
  }

  return result;
}

export default async function handler'''
replace_once('api/_handlers/health-summary.ts', health_marker, health_insert)

# Client response type exposes the breakdown.
replace_once(
    'src/services/healthSummaryService.ts',
    "export interface HealthSummaryResponse {",
    "export interface ActiveEnergySummaryPoint {\n  localDate: string; timestamp: string; totalCalories: number; movementCalories: number; workoutCalories: number;\n  steps: number; workoutSteps: number; source: string; quality: 'measured' | 'mixed' | 'estimated'; usedHealthDailyTotal: boolean;\n}\n\nexport interface HealthSummaryResponse {"
)
replace_once(
    'src/services/healthSummaryService.ts',
    "  trends: Partial<Record<TendenciaMetricType, PontoTendencia[]>>;\n  timeZone?: string;",
    "  trends: Partial<Record<TendenciaMetricType, PontoTendencia[]>>;\n  activeEnergy?: { latest: ActiveEnergySummaryPoint | null; trends: ActiveEnergySummaryPoint[] };\n  timeZone?: string;"
)

# Health UI: show today's consolidated total and its breakdown.
replace_once(
    'src/pages/Health.tsx',
    "import { healthSummaryService, HealthSummaryResponse } from '../services/healthSummaryService';",
    "import { healthSummaryService, HealthSummaryResponse, type ActiveEnergySummaryPoint } from '../services/healthSummaryService';"
)
regex_replace_once(
    'src/pages/Health.tsx',
    r"function EnergyBlock\(\{ calories, deviceCalories = 0 \}: \{ calories: number; deviceCalories\?: number \}\) \{.*?\n\}\n\n",
    '''function EnergyBlock({ calories, activeEnergy }: { calories: number; activeEnergy?: ActiveEnergySummaryPoint | null }) {
  const total = Math.max(0, Math.round(activeEnergy?.totalCalories || 0));
  const movement = Math.max(0, Math.round(activeEnergy?.movementCalories || 0));
  const workout = Math.max(0, Math.round(activeEnergy?.workoutCalories || 0));
  const quality = activeEnergy?.quality === 'measured' ? 'MEDIDO' : activeEnergy ? 'ESTIMADO' : '';
  return <article className="health-overview health-energy-card"><div className="health-section-name"><Flame /> GASTO ATIVO HOJE</div>
    <div className="health-energy-value"><strong>{total > 0 ? total.toLocaleString('pt-BR') : '—'}</strong><span>{total > 0 ? `kcal ativas · ${quality}` : 'Aguardando calorias ou passos do Health'}</span></div>
    {activeEnergy && <div className="health-energy-breakdown"><span><b>{movement.toLocaleString('pt-BR')}</b> kcal movimento</span><span><b>{workout.toLocaleString('pt-BR')}</b> kcal treino</span></div>}
    {calories > 0 && <div className="health-energy-device"><strong>{calories.toLocaleString('pt-BR')} kcal</strong><span>Treinos registrados no período selecionado</span></div>}
    <small>Quando o Health fornece o total diário, ele já pode incluir o treino e não é somado novamente. Sem total de calorias, o Invictus estima o movimento pelos passos fora dos treinos.</small></article>;
}

'''
)
replace_once(
    'src/pages/Health.tsx',
    "  const caloriasAtivas = summary?.latest.calories_active || null;",
    "  const activeEnergy = summary?.activeEnergy?.latest || null;"
)
replace_once(
    'src/pages/Health.tsx',
    "<EnergyBlock calories={calories} deviceCalories={caloriasAtivas?.value || 0} />",
    "<EnergyBlock calories={calories} activeEnergy={activeEnergy} />"
)
replace_once(
    'src/pages/Health.tsx',
    "  const latestActiveCalories = summary?.latest.calories_active;\n  return <main",
    "  const latestActiveCalories = summary?.latest.calories_active;\n  const latestActiveEnergy = summary?.activeEnergy?.latest;\n  return <main"
)
replace_once(
    'src/pages/Health.tsx',
    "<MetricCard icon={<Flame />} label=\"GASTO ATIVO ESTIMADO\" value={latestActiveCalories ? Math.round(latestActiveCalories.value).toLocaleString('pt-BR') : '—'} unit={latestActiveCalories ? 'kcal' : ''} detail={latestActiveCalories ? `Total diário · ${formatUltimaLeitura(latestActiveCalories.timestamp)}` : 'Sem gasto ativo recebido'} tone=\"gold\" />",
    "<MetricCard icon={<Flame />} label=\"GASTO ATIVO HOJE\" value={latestActiveEnergy ? Math.round(latestActiveEnergy.totalCalories).toLocaleString('pt-BR') : latestActiveCalories ? Math.round(latestActiveCalories.value).toLocaleString('pt-BR') : '—'} unit={latestActiveEnergy || latestActiveCalories ? 'kcal' : ''} detail={latestActiveEnergy ? `${Math.round(latestActiveEnergy.movementCalories)} movimento · ${Math.round(latestActiveEnergy.workoutCalories)} treino · ${latestActiveEnergy.quality === 'measured' ? 'medido' : 'estimado'}` : latestActiveCalories ? `Total diário · ${formatUltimaLeitura(latestActiveCalories.timestamp)}` : 'Sem gasto ativo recebido'} tone=\"gold\" />"
)
replace_once(
    'src/pages/Health.tsx',
    "  const steps = diagnostics.reads.find((read) => read.dataType === 'steps');\n  const hasErrors",
    "  const steps = diagnostics.reads.find((read) => read.dataType === 'steps');\n  const activeCalories = diagnostics.reads.find((read) => read.dataType === 'calories');\n  const hasErrors"
)
replace_once(
    'src/pages/Health.tsx',
    "<span>Passos: {steps?.status === 'ok' ? `${steps.count} dias agregados` : steps?.status === 'error' ? 'erro de leitura' : 'nenhum dia'}</span></p>",
    "<span>Passos: {steps?.status === 'ok' ? `${steps.count} dias agregados` : steps?.status === 'error' ? 'erro de leitura' : 'nenhum dia'}</span><span>Calorias: {activeCalories?.status === 'ok' ? `${activeCalories.count} dias agregados` : activeCalories?.status === 'error' ? 'erro de leitura' : 'sem total; usaremos passos quando possível'}</span></p>"
)

health_css = Path('src/pages/HealthNew.css')
health_css_text = health_css.read_text(encoding='utf-8')
health_marker = '/* daily-active-energy-v1 */'
if health_marker not in health_css_text:
    health_css_text += """

/* daily-active-energy-v1 */
.health-energy-breakdown{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.health-energy-breakdown>span{display:grid;gap:2px;padding:10px;border:1px solid rgba(255,183,25,.18);border-radius:9px;background:rgba(255,183,25,.045);color:#aaa;font-size:11px}.health-energy-breakdown b{color:#fff;font-size:15px}.health-energy-card>small{display:block;margin-top:10px;color:#85817d;font-size:10px;line-height:1.45}
"""
    health_css.write_text(health_css_text, encoding='utf-8')

# -----------------------------------------------------------------
# 5) Focused regression tests.
# -----------------------------------------------------------------
replace_once(
    'api/__tests__/activity-policy-modality.test.ts',
    "import { loadActivityCompetitionPolicySnapshot } from '../_lib/activity-competition-policy';",
    "import { loadActivityCompetitionPolicySnapshot, resolveActivityCompetitionPolicy } from '../_lib/activity-competition-policy';"
)
replace_once(
    'api/__tests__/activity-policy-modality.test.ts',
    "  test('loader aceita somente envelope, policy e requisição coerentes', async () => {",
    "  test('modo pessoal ignora adesões competitivas e não consulta ranking/geofence', async () => {\n    mockDb = { collection: jest.fn(() => { throw new Error('não deveria consultar o banco competitivo'); }) };\n    await expect(resolveActivityCompetitionPolicy({\n      userId: 'user-a', activityType: 'workout', isIndoorCardio: false, requestedMode: 'personal',\n    })).resolves.toMatchObject({\n      contexts: [], requiresSecurityReview: false, requiresGymCheckIn: false, requiresContinuousGps: false, requiresMotionSensors: false,\n    });\n    expect(mockDb.collection).not.toHaveBeenCalled();\n  });\n\n  test('loader aceita somente envelope, policy e requisição coerentes', async () => {"
)

Path('api/__tests__/active-energy-summary.test.ts').write_text(r'''import { buildDailyActiveEnergy, estimateMovementCaloriesFromSteps } from '../_lib/active-energy-summary';

const sample = (overrides: Partial<any> = {}) => ({
  value: 0,
  timestamp: '2026-09-08T12:00:00.000Z',
  localDate: '2026-09-08',
  source: 'health_connect',
  ...overrides,
});

describe('gasto ativo diário consolidado', () => {
  test('não soma o treino duas vezes quando Health já fornece total diário', () => {
    const [day] = buildDailyActiveEnergy({
      calorieSamples: [
        sample({ value: 700, aggregation: 'daily_total' }),
        sample({ value: 400, source: 'invictus_manual', sourceActivityId: 'workout-1', timestamp: '2026-09-08T10:00:00.000Z' }),
      ],
      stepsDailySamples: [sample({ value: 9000, aggregation: 'daily_total' })],
      stepsActivitySamples: [],
      weightKg: 70,
    });
    expect(day).toMatchObject({ totalCalories: 700, workoutCalories: 400, movementCalories: 300, usedHealthDailyTotal: true, quality: 'measured' });
  });

  test('sem total de calorias estima apenas passos fora do treino e soma a sessão', () => {
    const [day] = buildDailyActiveEnergy({
      calorieSamples: [sample({ value: 300, source: 'invictus_manual', sourceActivityId: 'workout-1' })],
      stepsDailySamples: [sample({ value: 10000, aggregation: 'daily_total' })],
      stepsActivitySamples: [sample({ value: 2000, sourceActivityId: 'workout-1' })],
      weightKg: 70,
    });
    expect(estimateMovementCaloriesFromSteps(8000, 70)).toBe(320);
    expect(day).toMatchObject({ totalCalories: 620, movementCalories: 320, workoutCalories: 300, steps: 10000, workoutSteps: 2000, usedHealthDailyTotal: false });
  });

  test('sem Health ainda preserva as calorias do treino', () => {
    const [day] = buildDailyActiveEnergy({
      calorieSamples: [sample({ value: 350, source: 'invictus_manual', sourceActivityId: 'workout-1' })],
      stepsDailySamples: [],
      stepsActivitySamples: [],
      weightKg: 82,
    });
    expect(day).toMatchObject({ totalCalories: 350, movementCalories: 0, workoutCalories: 350, quality: 'estimated' });
  });
});
''', encoding='utf-8')

print('Implementation patch applied successfully.')
