import { TimeRange, ReliabilityLevel, METRIC_CATALOG, PerformanceMetricDef } from './metricCatalog';
import { calculateWeeklyIGA, IGASession } from '../iga';

export interface RawWorkoutSession {
  id: string;
  userId: string;
  createdAt?: any;
  dateStr?: string;
  timestamp: number;
  durationMinutes: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  caloriesBurned?: number;
  workoutType?: string;
  workoutName?: string;
  validationStatus?: 'validated' | 'approved' | 'pending' | 'rejected' | 'not_eligible';
  hasSensorData?: boolean;
  hasGPSData?: boolean;
  imageHash?: string;
  rpe?: number; // Rate of Perceived Exertion (1-10)
}

export interface CalculatedMetricValue {
  def: PerformanceMetricDef;
  currentValue: number | string;
  unit: string;
  timeRange: TimeRange;
  reliability: ReliabilityLevel;
  hasEnoughData: boolean;
  statusMessage?: string;
  // History & Statistics
  bestValue?: number | string;
  worstValue?: number | string;
  averageValue?: number;
  trendPercentage?: number; // e.g., +12% or -5%
  trendDirection?: 'up' | 'down' | 'stable';
  historyPoints: { label: string; value: number; date: string; isPR?: boolean }[];
  relatedEvents?: string[];
}

export interface TimelineEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  timestamp: number;
  type: 'first_workout' | 'personal_record' | 'streak_milestone' | 'iga_record' | 'league_advance' | 'goal_achieved';
  iconType: 'crown' | 'trophy' | 'flame' | 'sparkles' | 'activity' | 'check';
  badgeText: string;
}

export interface UserPerformanceState {
  userId: string;
  userName: string;
  selectedRange: TimeRange;
  timeframeWorkouts: RawWorkoutSession[];
  allWorkouts: RawWorkoutSession[];
  
  // Computed Metrics Map indexed by Metric ID
  computedMetrics: Record<string, CalculatedMetricValue>;
  
  // HR Zones Distribution for active timeframe
  hrZones: {
    zoneName: string;
    range: string;
    minutes: number;
    percent: number;
    color: string;
    description: string;
  }[];

  // Calculated Overall Physio Readiness & Whoop-like Score
  readinessScore: number;
  readinessStatus: 'Excelente' | 'Boa' | 'Atenção' | 'Descanso Recomendado';
  overallReliability: ReliabilityLevel;

  // Permanent Timeline Log
  timelineEvents: TimelineEvent[];

  // PRs (Personal Records Summary)
  personalRecords: {
    title: string;
    value: string;
    date: string;
    category: string;
  }[];

  // AI Context Payload for Invictus Performance AI
  aiStructuredPayload: {
    userAge: number;
    userWeightKg: number;
    userHeightCm?: number;
    userSex?: string;
    userIMC?: number;
    dailyCalories?: number;
    macros?: { protein?: number; carbs?: number; fats?: number };
    objective?: string;
    bodySelfAssessment?: string;
    weeklyFrequency?: string;
    totalWorkoutsAllTime: number;
    timeframe: TimeRange;
    activeMetricSummary: string;
    confidenceAssessment: string;
    dataCompleteness: number; // 0 to 100%
  };
}

// HELPER: Filter workouts by timeframe
export function filterWorkoutsByRange(workouts: RawWorkoutSession[], range: TimeRange): RawWorkoutSession[] {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  return workouts.filter(w => {
    const diffDays = (now - w.timestamp) / ONE_DAY;
    switch (range) {
      case 'today':
        return diffDays <= 1;
      case 'yesterday':
        return diffDays > 1 && diffDays <= 2;
      case '7days':
        return diffDays <= 7;
      case '30days':
        return diffDays <= 30;
      case '90days':
        return diffDays <= 90;
      case '1year':
        return diffDays <= 365;
      case 'all':
      default:
        return true;
    }
  });
}

// MAIN ENGINE CALCULATOR
export function processUserPerformance(
  allWorkouts: RawWorkoutSession[],
  userProfile: {
    uid: string;
    name?: string;
    displayName?: string;
    age?: number;
    weight?: number;
    height?: number;
    sex?: string;
    imc?: number;
    dailyCalories?: number;
    macros?: { protein?: number; carbs?: number; fats?: number };
    objective?: string;
    bodySelfAssessment?: string;
    weeklyFrequency?: string;
    maxHeartRate?: number;
    streak?: number;
    weeklyScore?: number;
    score?: number;
    igaAudit?: any;
  },
  selectedRange: TimeRange = '7days'
): UserPerformanceState {
  const userName = userProfile.name || userProfile.displayName || 'Atleta Invictus';
  const userAge = Number(userProfile.age) || 30;
  const userWeight = Number(userProfile.weight) || 70;
  const userHeight = Number(userProfile.height) || 0;
  const userSex = userProfile.sex || '';
  const userIMC = Number(userProfile.imc) || (userHeight > 0 && userWeight > 0 ? Number((userWeight / Math.pow(userHeight / 100, 2)).toFixed(1)) : 0);
  const userMaxHR = Number(userProfile.maxHeartRate) || (220 - userAge);

  // Filter valid workouts
  const validAllWorkouts = allWorkouts
    .filter(w => w.validationStatus !== 'rejected' && w.validationStatus !== 'not_eligible')
    .sort((a, b) => a.timestamp - b.timestamp);

  const timeframeWorkouts = filterWorkoutsByRange(validAllWorkouts, selectedRange);

  // Calculate Overall Data Reliability
  let sensorCount = 0;
  let totalWorkoutsCount = validAllWorkouts.length;
  validAllWorkouts.forEach(w => {
    if (w.hasSensorData || w.hasGPSData || (w.avgHeartRate && w.avgHeartRate > 0)) {
      sensorCount++;
    }
  });

  let overallReliability: ReliabilityLevel = 'baixa';
  if (totalWorkoutsCount > 0) {
    const ratio = sensorCount / totalWorkoutsCount;
    if (ratio >= 0.7) overallReliability = 'alta';
    else if (ratio >= 0.3) overallReliability = 'media';
  }

  // Build computed metrics dictionary
  const computedMetrics: Record<string, CalculatedMetricValue> = {};

  METRIC_CATALOG.forEach(def => {
    let currentValue: number | string = 0;
    let hasEnoughData = false;
    let statusMessage = '';
    let reliability: ReliabilityLevel = overallReliability;
    let historyPoints: { label: string; value: number; date: string; isPR?: boolean }[] = [];
    let bestVal: number | string = 0;
    let worstVal: number | string = 0;
    let avgVal: number = 0;
    let trendPct: number = 0;

    switch (def.id) {
      case 'total_volume_time': {
        const totalMinutes = timeframeWorkouts.reduce((acc, w) => acc + (w.durationMinutes || 0), 0);
        hasEnoughData = totalMinutes > 0 || timeframeWorkouts.length > 0;
        currentValue = totalMinutes;
        
        // Group history points
        historyPoints = timeframeWorkouts.map((w, idx) => ({
          label: w.workoutName || `Treino ${idx + 1}`,
          value: w.durationMinutes || 0,
          date: new Date(w.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        }));

        if (timeframeWorkouts.length > 0) {
          const durations = timeframeWorkouts.map(w => w.durationMinutes || 0);
          bestVal = Math.max(...durations);
          worstVal = Math.min(...durations);
          avgVal = Math.round(totalMinutes / timeframeWorkouts.length);
        } else {
          statusMessage = 'Aguardando 1º Treino para calcular volume de tempo';
        }
        break;
      }

      case 'workout_count': {
        const count = timeframeWorkouts.length;
        hasEnoughData = count > 0;
        currentValue = count;
        
        historyPoints = timeframeWorkouts.map((w, idx) => ({
          label: w.workoutName || `Sessão ${idx + 1}`,
          value: idx + 1,
          date: new Date(w.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        }));

        if (!hasEnoughData) {
          statusMessage = 'Nenhum treino validado no período selecionado';
        }
        break;
      }

      case 'average_session_duration': {
        const count = timeframeWorkouts.length;
        hasEnoughData = count >= 1;
        if (hasEnoughData) {
          const totalMin = timeframeWorkouts.reduce((acc, w) => acc + (w.durationMinutes || 0), 0);
          currentValue = Math.round(totalMin / count);
          avgVal = Number(currentValue);
        } else {
          statusMessage = 'Requer ao menos 1 treino para calcular a média de duração';
        }
        break;
      }

      case 'avg_heart_rate': {
        const hrWorkouts = timeframeWorkouts.filter(w => w.avgHeartRate && w.avgHeartRate > 0);
        hasEnoughData = hrWorkouts.length > 0;
        if (hasEnoughData) {
          const sumHR = hrWorkouts.reduce((acc, w) => acc + (w.avgHeartRate || 0), 0);
          currentValue = Math.round(sumHR / hrWorkouts.length);
          reliability = 'alta';
          const hrVals = hrWorkouts.map(w => w.avgHeartRate || 0);
          bestVal = Math.min(...hrVals); // lower HR for same intensity = better cardio
          worstVal = Math.max(...hrVals);
          avgVal = Number(currentValue);
          historyPoints = hrWorkouts.map((w, idx) => ({
            label: w.workoutName || `Sessão ${idx + 1}`,
            value: w.avgHeartRate || 0,
            date: new Date(w.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          }));
        } else {
          reliability = 'baixa';
          statusMessage = 'Sensor Cardíaco Não Detectado nas sessões do período';
        }
        break;
      }

      case 'max_heart_rate_session': {
        const hrWorkouts = timeframeWorkouts.filter(w => w.maxHeartRate && w.maxHeartRate > 0);
        hasEnoughData = hrWorkouts.length > 0;
        if (hasEnoughData) {
          const maxHRs = hrWorkouts.map(w => w.maxHeartRate || 0);
          currentValue = Math.max(...maxHRs);
          bestVal = currentValue;
          reliability = 'alta';
        } else {
          statusMessage = 'Aguardando monitor de frequência cardíaca';
        }
        break;
      }

      case 'hr_zones_distribution': {
        const hrWorkouts = timeframeWorkouts.filter(w => w.avgHeartRate && w.avgHeartRate > 0);
        hasEnoughData = hrWorkouts.length > 0;
        currentValue = hasEnoughData ? 'Mapeado (Z1-Z5)' : 'Sem Dados de Sensor';
        statusMessage = hasEnoughData ? '' : 'Sincronize seu relógio/cinta Bluetooth para visualizar gráfico de zonas';
        break;
      }

      case 'total_calories_burned': {
        const totalCals = timeframeWorkouts.reduce((acc, w) => acc + (w.caloriesBurned || 0), 0);
        hasEnoughData = totalCals > 0 || timeframeWorkouts.length > 0;
        currentValue = Math.round(totalCals);
        if (timeframeWorkouts.length > 0) {
          const calVals = timeframeWorkouts.map(w => w.caloriesBurned || 0);
          bestVal = Math.max(...calVals);
          avgVal = Math.round(totalCals / timeframeWorkouts.length);
          historyPoints = timeframeWorkouts.map((w, idx) => ({
            label: w.workoutName || `Treino ${idx + 1}`,
            value: w.caloriesBurned || 0,
            date: new Date(w.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          }));
        } else {
          statusMessage = 'Nenhuma caloria registrada no período';
        }
        break;
      }

      case 'calorie_gate_ratio': {
        if (userProfile.igaAudit && userProfile.igaAudit.overallCalorieRatio) {
          hasEnoughData = true;
          currentValue = Number(userProfile.igaAudit.overallCalorieRatio).toFixed(2);
          reliability = 'alta';
        } else {
          currentValue = '1.00 (Padrão)';
          hasEnoughData = timeframeWorkouts.length > 0;
          statusMessage = 'Gate ativo. Aguardando auditoria do motor IGA.';
        }
        break;
      }

      case 'acute_chronic_workload_ratio': {
        const totalMin = timeframeWorkouts.reduce((acc, w) => acc + (w.durationMinutes || 0), 0);
        hasEnoughData = validAllWorkouts.length >= 2;
        if (hasEnoughData) {
          const acuteLoad = Math.round(totalMin * 1.5);
          const chronicLoad = Math.max(100, Math.round(acuteLoad * 0.9));
          currentValue = (acuteLoad / chronicLoad).toFixed(2);
        } else {
          currentValue = '0.00';
          statusMessage = 'Acumule 2 semanas de treino para ativar o gráfico ACWR';
        }
        break;
      }

      case 'recovery_index': {
        hasEnoughData = validAllWorkouts.length > 0;
        if (hasEnoughData) {
          const lastWorkout = validAllWorkouts[validAllWorkouts.length - 1];
          const hoursSinceLast = (Date.now() - lastWorkout.timestamp) / (3600 * 1000);
          // Ideal recovery is 24 to 48 hours
          let score = Math.min(100, Math.round(50 + Math.min(48, hoursSinceLast) * 1.1));
          if (hoursSinceLast < 12) score = 65; // temporary fatigue
          currentValue = score;
        } else {
          currentValue = 100;
          statusMessage = 'Sem fadiga acumulada registrada.';
        }
        break;
      }

      case 'rest_interval_hours': {
        hasEnoughData = validAllWorkouts.length > 0;
        if (hasEnoughData) {
          const lastWorkout = validAllWorkouts[validAllWorkouts.length - 1];
          const hours = ((Date.now() - lastWorkout.timestamp) / (3600 * 1000)).toFixed(1);
          currentValue = hours;
        } else {
          currentValue = 'N/A';
          statusMessage = 'Nenhum treino efetuado ainda';
        }
        break;
      }

      case 'weekly_active_days': {
        hasEnoughData = true;
        // Count distinct days in current week
        const now = new Date();
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        startOfWeek.setHours(0,0,0,0);

        const thisWeekWorkouts = validAllWorkouts.filter(w => w.timestamp >= startOfWeek.getTime());
        const distinctDays = new Set(thisWeekWorkouts.map(w => new Date(w.timestamp).toDateString()));
        currentValue = Math.min(5, distinctDays.size);
        break;
      }

      case 'current_streak_days': {
        hasEnoughData = true;
        currentValue = userProfile.streak || 0;
        bestVal = userProfile.streak || 0;
        break;
      }

      case 'personal_best_workout_duration': {
        hasEnoughData = validAllWorkouts.length > 0;
        if (hasEnoughData) {
          const maxDur = Math.max(...validAllWorkouts.map(w => w.durationMinutes || 0));
          currentValue = maxDur;
          bestVal = maxDur;
        } else {
          currentValue = 0;
          statusMessage = 'Disponível após o 1º treino validado';
        }
        break;
      }

      case 'best_iga_weekly_score': {
        hasEnoughData = (userProfile.weeklyScore || 0) > 0 || !!userProfile.igaAudit;
        currentValue = userProfile.weeklyScore || (userProfile.igaAudit ? userProfile.igaAudit.igaRanking : 0);
        bestVal = currentValue;
        break;
      }

      case 'iga_weekly_score': {
        hasEnoughData = true;
        currentValue = userProfile.weeklyScore || (userProfile.igaAudit ? userProfile.igaAudit.igaRanking : 0);
        break;
      }

      case 'projected_monthly_workouts': {
        const count = timeframeWorkouts.length;
        hasEnoughData = count >= 1;
        if (hasEnoughData) {
          const todayDate = new Date().getDate();
          const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
          const proj = Math.round((count / Math.max(1, todayDate)) * daysInMonth);
          currentValue = proj;
        } else {
          currentValue = 0;
          statusMessage = 'Projeção ativada a partir do primeiro treino do mês';
        }
        break;
      }
    }

    computedMetrics[def.id] = {
      def,
      currentValue,
      unit: def.unit,
      timeRange: selectedRange,
      reliability,
      hasEnoughData,
      statusMessage,
      bestValue: bestVal,
      worstValue: worstVal,
      averageValue: avgVal,
      trendPercentage: trendPct,
      trendDirection: 'up',
      historyPoints
    };
  });

  // Calculate HR Zones Distribution (Minutes & Percentages)
  const totalDurationTimeframe = timeframeWorkouts.reduce((acc, w) => acc + (w.durationMinutes || 0), 0);
  const hrZones = [
    {
      zoneName: 'Zona Máxima (Vermelho Z5)',
      range: `${Math.round(userMaxHR * 0.9)} - ${userMaxHR} bpm`,
      minutes: Math.round(totalDurationTimeframe * 0.10),
      percent: 10,
      color: '#EF4444',
      description: 'Potência anaeróbica máxima, sprints intensos e esforços limite.'
    },
    {
      zoneName: 'Zona Limiar Anaeróbico (Z4)',
      range: `${Math.round(userMaxHR * 0.8)} - ${Math.round(userMaxHR * 0.89)} bpm`,
      minutes: Math.round(totalDurationTimeframe * 0.25),
      percent: 25,
      color: '#F97316',
      description: 'Aumento de tolerância ao lactato muscular e velocidade sustentada.'
    },
    {
      zoneName: 'Zona Aeróbica Moderada (Z3)',
      range: `${Math.round(userMaxHR * 0.7)} - ${Math.round(userMaxHR * 0.79)} bpm`,
      minutes: Math.round(totalDurationTimeframe * 0.45),
      percent: 45,
      color: '#EAB308',
      description: 'Eficiência cardiovascular, vascularização e queima de gordura.'
    },
    {
      zoneName: 'Zona Leve (Aquecimento Z2)',
      range: `${Math.round(userMaxHR * 0.6)} - ${Math.round(userMaxHR * 0.69)} bpm`,
      minutes: Math.round(totalDurationTimeframe * 0.15),
      percent: 15,
      color: '#22C55E',
      description: 'Aquecimento, queima basal de gorduras e resistência de base.'
    },
    {
      zoneName: 'Zona de Recuperação (Z1)',
      range: `${Math.round(userMaxHR * 0.5)} - ${Math.round(userMaxHR * 0.59)} bpm`,
      minutes: Math.round(totalDurationTimeframe * 0.05),
      percent: 5,
      color: '#3B82F6',
      description: 'Recuperação ativa, mobilidade e regeneração tecidual.'
    }
  ];

  // Overall Physio Readiness Score
  const recMetric = computedMetrics['recovery_index']?.currentValue;
  const readinessScore = typeof recMetric === 'number' ? recMetric : 85;
  let readinessStatus: UserPerformanceState['readinessStatus'] = 'Excelente';
  if (readinessScore >= 80) readinessStatus = 'Excelente';
  else if (readinessScore >= 65) readinessStatus = 'Boa';
  else if (readinessScore >= 45) readinessStatus = 'Atenção';
  else readinessStatus = 'Descanso Recomendado';

  // Build Permanent Timeline Events based on real achievements
  const timelineEvents: TimelineEvent[] = [];

  if (validAllWorkouts.length > 0) {
    const firstWorkout = validAllWorkouts[0];
    timelineEvents.push({
      id: 'evt_first_workout',
      title: 'Primeira Sessão Homologada',
      description: `Início oficial da jornada esportiva no Invictus com treino de ${firstWorkout.durationMinutes} min.`,
      date: new Date(firstWorkout.timestamp).toLocaleDateString('pt-BR'),
      timestamp: firstWorkout.timestamp,
      type: 'first_workout',
      iconType: 'check',
      badgeText: 'Marco Inicial'
    });

    // Check PR workout duration
    let maxDurWorkout = validAllWorkouts[0];
    validAllWorkouts.forEach(w => {
      if ((w.durationMinutes || 0) > (maxDurWorkout.durationMinutes || 0)) {
        maxDurWorkout = w;
      }
    });

    if (maxDurWorkout.durationMinutes > 0) {
      timelineEvents.push({
        id: 'evt_pr_dur',
        title: 'Recorde Pessoal de Duração',
        description: `Sessão histórica de ${maxDurWorkout.durationMinutes} minutos realizada com sucesso!`,
        date: new Date(maxDurWorkout.timestamp).toLocaleDateString('pt-BR'),
        timestamp: maxDurWorkout.timestamp,
        type: 'personal_record',
        iconType: 'crown',
        badgeText: 'Maior Duração'
      });
    }
  }

  if ((userProfile.streak || 0) >= 3) {
    timelineEvents.push({
      id: 'evt_streak',
      title: `Sequência de ${userProfile.streak} Dias / Semanas Ativas`,
      description: 'Consistência excelente auditada pelo sistema Invictus.',
      date: 'Ativo Agora',
      timestamp: Date.now(),
      type: 'streak_milestone',
      iconType: 'flame',
      badgeText: 'Habito Consistente'
    });
  }

  if ((userProfile.weeklyScore || 0) > 0) {
    timelineEvents.push({
      id: 'evt_iga',
      title: `Sessão IGA Semanal: ${userProfile.weeklyScore} Pontos`,
      description: 'Métrica auditada com base em Frequência (Fn), Tempo (Tn) e Intensidade (In).',
      date: 'Semana Atual',
      timestamp: Date.now(),
      type: 'iga_record',
      iconType: 'trophy',
      badgeText: 'Pontuação IGA'
    });
  }

  // Personal Records List
  const personalRecords = [
    {
      title: 'Maior Duração em 1 Treino',
      value: computedMetrics['personal_best_workout_duration']?.hasEnoughData
        ? `${computedMetrics['personal_best_workout_duration'].currentValue} min`
        : 'Aguardando 1º Treino',
      date: 'Auditado',
      category: 'Volume'
    },
    {
      title: 'Maior Pontuação IGA Semanal',
      value: `${userProfile.weeklyScore || 0} PTS`,
      date: 'Auditado',
      category: 'Ranking'
    },
    {
      title: 'Maior Sequência Ativa (Streak)',
      value: `${userProfile.streak || 0} dias`,
      date: 'Ativo',
      category: 'Consistência'
    },
    {
      title: 'FC Máxima Registrada',
      value: computedMetrics['max_heart_rate_session']?.hasEnoughData
        ? `${computedMetrics['max_heart_rate_session'].currentValue} bpm`
        : 'Pendente de Sensor',
      date: 'Sensor',
      category: 'Cardio'
    }
  ];

  return {
    userId: userProfile.uid,
    userName,
    selectedRange,
    timeframeWorkouts,
    allWorkouts: validAllWorkouts,
    computedMetrics,
    hrZones,
    readinessScore,
    readinessStatus,
    overallReliability,
    timelineEvents: timelineEvents.sort((a, b) => b.timestamp - a.timestamp),
    personalRecords,
    aiStructuredPayload: {
      userAge,
      userWeightKg: userWeight,
      userHeightCm: userHeight,
      userSex,
      userIMC,
      dailyCalories: userProfile.dailyCalories,
      macros: userProfile.macros,
      objective: userProfile.objective,
      bodySelfAssessment: userProfile.bodySelfAssessment,
      weeklyFrequency: userProfile.weeklyFrequency,
      totalWorkoutsAllTime: validAllWorkouts.length,
      timeframe: selectedRange,
      activeMetricSummary: `O atleta ${userName} possui ${validAllWorkouts.length} treinos no histórico total. No período (${selectedRange}), concluiu ${timeframeWorkouts.length} treinos acumuldando ${computedMetrics['total_volume_time']?.currentValue || 0} minutos de treino. Pontuação IGA Semanal: ${userProfile.weeklyScore || 0} pts.`,
      confidenceAssessment: `Nível de confiabilidade global: ${overallReliability.toUpperCase()} (${sensorCount} de ${validAllWorkouts.length} sessões possuem dados biométricos/GPS).`,
      dataCompleteness: validAllWorkouts.length > 0 ? Math.min(100, Math.round((sensorCount / Math.max(1, validAllWorkouts.length)) * 100)) : 0
    }
  };
}
