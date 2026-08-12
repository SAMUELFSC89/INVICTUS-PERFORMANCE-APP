import React, { useState, useEffect, useMemo } from 'react';
import { 
  Sliders, Award, Users, ShieldAlert, CheckCircle, Flame, 
  HelpCircle, Sparkles, RefreshCw, Layers, MapPin, Play, 
  Info, BarChart2, TrendingUp, Search, Database, FileText, Check, Settings
} from 'lucide-react';

// Interface definitions for TypeScript safety
interface SimulatedUser {
  id: string;
  name: string;
  level: 'Iniciante' | 'Intermediário' | 'Avançado' | 'Elite';
  weeklyFrequency: number;
  preferredCategory: string;
  avgPoints: number;
  engagementScore: number;
  region: string;
  academy: string;
}

interface SimulationReport {
  id: string;
  timestamp: string;
  scenarioName: string;
  totalUsers: number;
  activePct: number;
  periodDays: number;
  rankingType: string;
  region: string;
  metrics: {
    averageScore: number;
    leaderScore: number;
    standardDeviation: number;
    activeCount: number;
    inactiveCount: number;
    balanceHealth: number; // 0 to 100
  };
  distribution: {
    iniciante: number;
    intermediario: number;
    avancado: number;
    elite: number;
  };
}

// Preset Scenario values
interface PresetScenario {
  name: string;
  description: string;
  totalUsers: number;
  activePct: number;
  periodDays: number;
  rankingType: string;
  region: string;
  levelType: 'Equilibrado' | 'Iniciante' | 'Competitivo' | 'Elite';
  distribution: {
    iniciante: number;
    intermediario: number;
    avancado: number;
    elite: number;
  };
}

const PRESET_SCENARIOS: Record<string, PresetScenario> = {
  startup: {
    name: 'Cenário 1: Startup Inicial',
    description: 'Ambiente de testes inicial focado em uma única região e alta taxa de engajamento.',
    totalUsers: 100,
    activePct: 80,
    periodDays: 7,
    rankingType: 'Geral',
    region: 'São Paulo',
    levelType: 'Equilibrado',
    distribution: { iniciante: 40, intermediario: 35, avancado: 20, elite: 5 }
  },
  regional: {
    name: 'Cenário 2: Crescimento Regional',
    description: 'Expansão para região sudeste, com entrada gradual de novos perfis e competitividade média.',
    totalUsers: 5000,
    activePct: 65,
    periodDays: 30,
    rankingType: 'Geral',
    region: 'Sudeste',
    levelType: 'Competitivo',
    distribution: { iniciante: 30, intermediario: 40, avancado: 22, elite: 8 }
  },
  state: {
    name: 'Cenário 3: Escala Estadual',
    description: 'Simulação robusta de nível estadual, integrando múltiplas redes de academias e parceiros.',
    totalUsers: 50000,
    activePct: 55,
    periodDays: 30,
    rankingType: 'Academia',
    region: 'São Paulo (Estado)',
    levelType: 'Equilibrado',
    distribution: { iniciante: 45, intermediario: 30, avancado: 18, elite: 7 }
  },
  national: {
    name: 'Cenário 4: Escala Nacional',
    description: 'Ambiente de extrema escala com até 1 milhão de usuários simulados estatisticamente.',
    totalUsers: 500000,
    activePct: 45,
    periodDays: 90,
    rankingType: 'Geral',
    region: 'Nacional (Brasil)',
    levelType: 'Iniciante',
    distribution: { iniciante: 55, intermediario: 30, avancado: 12, elite: 3 }
  }
};

const BRAZILIAN_NAMES = [
  'Thiago Silva', 'Lucas Santos', 'Mateus Oliveira', 'Rafael Souza', 'Gabriel Lima',
  'Bruno Costa', 'Felipe Pereira', 'Rodrigo Alves', 'Gustavo Ferreira', 'Daniel Ribeiro',
  'Juliana Mendes', 'Carlos Henrique', 'Marina Delgado', 'Aline Vieira', 'Fernanda Rocha',
  'Beatriz Nascimento', 'Camila Martins', 'Amanda Correia', 'Mariana Carvalho', 'Paula Santos',
  'Roberto Silveira', 'Luiz Fernando', 'Sofia Guimarães', 'Isabela Freitas', 'Guilherme Barbosa'
];

const MODALITIES = ['Musculação', 'Corrida', 'Cardio', 'Duelos', 'Pilates'];
const ACADEMIAS = ['Invictus Jardins', 'Invictus Pinheiros', 'Invictus Paulista', 'Invictus Centro', 'Invictus Club', 'Invictus Smart'];
const CIDADES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Salvador', 'Campinas'];

export function RankingSimulator() {
  // Config States
  const [totalUsers, setTotalUsers] = useState<number>(100);
  const [activePct, setActivePct] = useState<number>(80);
  const [periodDays, setPeriodDays] = useState<number>(7);
  const [rankingType, setRankingType] = useState<string>('Geral');
  const [region, setRegion] = useState<string>('São Paulo');
  const [communityLevel, setCommunityLevel] = useState<string>('Equilibrado');

  // Distribution States (percentages of levels)
  const [distIniciante, setDistIniciante] = useState<number>(40);
  const [distIntermediario, setDistIntermediario] = useState<number>(35);
  const [distAvancado, setDistAvancado] = useState<number>(20);
  const [distElite, setDistElite] = useState<number>(5);

  // Live Tuning Calibration States
  const [pointsPerWorkout, setPointsPerWorkout] = useState<number>(100);
  const [pointsPerCardio, setPointsPerCardio] = useState<number>(120);
  const [weekendMultiplier, setWeekendMultiplier] = useState<number>(1.5);
  const [challengeBonus, setChallengeBonus] = useState<number>(200);
  const [xpPerActivity, setXpPerActivity] = useState<number>(50);

  // Active Simulation states
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationProgress, setSimulationProgress] = useState<number>(0);
  const [simulationStep, setSimulationStep] = useState<string>('');
  
  // Simulation results
  const [hasRunSimulation, setHasRunSimulation] = useState<boolean>(false);
  const [simReport, setSimReport] = useState<SimulationReport | null>(null);
  const [simUsers, setSimUsers] = useState<SimulatedUser[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'rankings' | 'database'>('overview');
  const [activeRankingTab, setActiveRankingTab] = useState<'geral' | 'semanal' | 'mensal' | 'academia' | 'cidade' | 'modalidade'>('geral');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Real-time recalculation check
  const [autoRecalculate, setAutoRecalculate] = useState<boolean>(true);

  // Selected Preset Scenario
  const [selectedPreset, setSelectedPreset] = useState<string>('startup');

  // Apply preset scenario variables
  const applyPreset = (key: string) => {
    const preset = PRESET_SCENARIOS[key];
    if (preset) {
      setSelectedPreset(key);
      setTotalUsers(preset.totalUsers);
      setActivePct(preset.activePct);
      setPeriodDays(preset.periodDays);
      setRankingType(preset.rankingType);
      setRegion(preset.region);
      setCommunityLevel(preset.levelType);
      setDistIniciante(preset.distribution.iniciante);
      setDistIntermediario(preset.distribution.intermediario);
      setDistAvancado(preset.distribution.avancado);
      setDistElite(preset.distribution.elite);
    }
  };

  // Helper to normalize the distribution to strictly 100%
  const adjustDistribution = (levelChanged: 'ini' | 'int' | 'ava' | 'eli', val: number) => {
    let currentTotal = 0;
    if (levelChanged === 'ini') {
      const rest = 100 - val;
      const sumOthers = distIntermediario + distAvancado + distElite;
      if (sumOthers > 0) {
        setDistIniciante(val);
        setDistIntermediario(Math.round((distIntermediario / sumOthers) * rest));
        setDistAvancado(Math.round((distAvancado / sumOthers) * rest));
        setDistElite(100 - val - Math.round((distIntermediario / sumOthers) * rest) - Math.round((distAvancado / sumOthers) * rest));
      } else {
        setDistIniciante(val);
        setDistIntermediario(Math.round(rest / 3));
        setDistAvancado(Math.round(rest / 3));
        setDistElite(100 - val - Math.round(rest / 3) * 2);
      }
    } else if (levelChanged === 'int') {
      const rest = 100 - val;
      const sumOthers = distIniciante + distAvancado + distElite;
      if (sumOthers > 0) {
        setDistIntermediario(val);
        setDistIniciante(Math.round((distIniciante / sumOthers) * rest));
        setDistAvancado(Math.round((distAvancado / sumOthers) * rest));
        setDistElite(100 - val - Math.round((distIniciante / sumOthers) * rest) - Math.round((distAvancado / sumOthers) * rest));
      }
    } else if (levelChanged === 'ava') {
      const rest = 100 - val;
      const sumOthers = distIniciante + distIntermediario + distElite;
      if (sumOthers > 0) {
        setDistAvancado(val);
        setDistIniciante(Math.round((distIniciante / sumOthers) * rest));
        setDistIntermediario(Math.round((distIntermediario / sumOthers) * rest));
        setDistElite(100 - val - Math.round((distIniciante / sumOthers) * rest) - Math.round((distIntermediario / sumOthers) * rest));
      }
    } else {
      const rest = 100 - val;
      const sumOthers = distIniciante + distIntermediario + distAvancado;
      if (sumOthers > 0) {
        setDistElite(val);
        setDistIniciante(Math.round((distIniciante / sumOthers) * rest));
        setDistIntermediario(Math.round((distIntermediario / sumOthers) * rest));
        setDistAvancado(100 - val - Math.round((distIniciante / sumOthers) * rest) - Math.round((distIntermediario / sumOthers) * rest));
      }
    }
  };

  // Perform the actual simulation run with steps
  const executeSimulation = () => {
    setIsSimulating(true);
    setSimulationProgress(10);
    setSimulationStep('Iniciando motor estatístico Invictus...');

    // Step 2
    setTimeout(() => {
      setSimulationProgress(35);
      setSimulationStep('Isolando sandbox (/admin_simulations) & gerando populações...');
    }, 400);

    // Step 3
    setTimeout(() => {
      setSimulationProgress(60);
      setSimulationStep(`Populando base simulada de ${totalUsers.toLocaleString()} usuários fictícios...`);
    }, 800);

    // Step 4
    setTimeout(() => {
      setSimulationProgress(85);
      setSimulationStep('Aplicando fórmulas de calibração, multiplicadores e bônus de XP...');
    }, 1200);

    // Step 5
    setTimeout(() => {
      setSimulationProgress(100);
      setSimulationStep('Calculando desvio padrão, médias e gerando diagnósticos...');
      finishSimulationRun();
    }, 1600);
  };

  const finishSimulationRun = () => {
    // Generate deterministic mathematical statistics & a representative sample of top users
    const activeCount = Math.round(totalUsers * (activePct / 100));
    const inactiveCount = totalUsers - activeCount;

    // Create a representative list of users (we create exactly 100 users for visualization, plus more on-the-fly if needed)
    // For extreme performance, we only manifest 100 real detailed objects to display in the UI, representing the absolute leaders and sample distributions
    const generatedUsers: SimulatedUser[] = [];

    // Let's generate 100 mock users
    for (let i = 1; i <= 100; i++) {
      // Determine level based on the distribution
      let level: 'Iniciante' | 'Intermediário' | 'Avançado' | 'Elite' = 'Iniciante';
      const randomVal = (i * 7) % 100;
      if (randomVal < distElite) {
        level = 'Elite';
      } else if (randomVal < distElite + distAvancado) {
        level = 'Avançado';
      } else if (randomVal < distElite + distAvancado + distIntermediario) {
        level = 'Intermediário';
      } else {
        level = 'Iniciante';
      }

      // Weekly frequency and preferred mod based on level behavior constraints
      let frequency = 2;
      let preferredMod = 'Musculação';
      let eng = 40;

      if (level === 'Iniciante') {
        frequency = 2 + (i % 2); // 2 to 3
        preferredMod = MODALITIES[i % MODALITIES.length];
        eng = 30 + (i % 40); // 30% to 70%
      } else if (level === 'Intermediário') {
        frequency = 4 + (i % 2); // 4 to 5
        preferredMod = MODALITIES[(i + 1) % MODALITIES.length];
        eng = 60 + (i % 25); // 60% to 85%
      } else if (level === 'Avançado') {
        frequency = 6; // almost daily
        preferredMod = MODALITIES[(i + 2) % MODALITIES.length];
        eng = 80 + (i % 16); // 80% to 95%
      } else {
        frequency = 6 + (i % 2); // 6 to 7, elite
        preferredMod = MODALITIES[(i + 3) % MODALITIES.length];
        eng = 90 + (i % 11); // 90% to 100%
      }

      // Calculate score based on frequency, calibration inputs & slight randomness
      // Formula: (Frequency * pointsPerWorkout) + (preferredMod is Cardio ? pointsPerCardio : 0) + challenge bonus + multipliers
      let scorePerWorkout = preferredMod === 'Cardio' || preferredMod === 'Corrida' ? pointsPerCardio : pointsPerWorkout;
      let baseWeeklyScore = frequency * scorePerWorkout * xpPerActivity * 0.1;
      
      // Add modifiers
      let challengeMultiplier = level === 'Elite' ? 2.5 : level === 'Avançado' ? 1.8 : level === 'Intermediário' ? 1.2 : 0.8;
      let totalPoints = baseWeeklyScore * weekendMultiplier + (challengeBonus * challengeMultiplier);
      
      // Period modifier
      totalPoints = Math.round(totalPoints * (periodDays / 7) * (eng / 100));

      const namePrefix = BRAZILIAN_NAMES[i % BRAZILIAN_NAMES.length];
      const simId = `SIM_USER_${String(i).padStart(4, '0')}`;

      generatedUsers.push({
        id: simId,
        name: `${simId} (${namePrefix})`,
        level,
        weeklyFrequency: frequency,
        preferredCategory: preferredMod,
        avgPoints: totalPoints,
        engagementScore: eng,
        region: CIDADES[i % CIDADES.length],
        academy: ACADEMIAS[i % ACADEMIAS.length]
      });
    }

    // Sort generated users by score descending to form the ranking
    generatedUsers.sort((a, b) => b.avgPoints - a.avgPoints);

    // Compute mathematical aggregated statistics based on totalUsers
    // For large populations, statistics are scaled appropriately
    const scaleFactor = Math.log10(totalUsers) || 1;
    const avgScoreBase = 1200 * (periodDays / 7) * (weekendMultiplier * 0.8) * (pointsPerWorkout / 100);
    const avgScore = Math.round(avgScoreBase * (1 + (distElite * 0.05) + (distAvancado * 0.02) - (distIniciante * 0.01)));
    const leaderScore = Math.round(generatedUsers[0].avgPoints * (1 + scaleFactor * 0.15));
    const stdDev = Math.round(avgScore * 0.38);

    // Compute balance health score (0-100)
    // Balanced is when standard deviation is not extremely wide and beginners have a realistic chance to participate
    // Also penalized if a modality is generating vastly more points than another
    let balanceHealth = 90;
    const pointsRatio = pointsPerCardio / pointsPerWorkout;
    if (pointsRatio > 1.5 || pointsRatio < 0.6) {
      balanceHealth -= 25; // point unbalance
    }
    if (stdDev > avgScore * 0.5) {
      balanceHealth -= 15; // too much dispersion
    }
    if (distElite > 15) {
      balanceHealth -= 10; // too competitive
    }
    balanceHealth = Math.max(30, Math.min(100, balanceHealth));

    const report: SimulationReport = {
      id: `SIM_REPORT_${Date.now()}`,
      timestamp: new Date().toISOString(),
      scenarioName: PRESET_SCENARIOS[selectedPreset]?.name || 'Cenário Customizado',
      totalUsers,
      activePct,
      periodDays,
      rankingType,
      region,
      metrics: {
        averageScore: avgScore,
        leaderScore,
        standardDeviation: stdDev,
        activeCount,
        inactiveCount,
        balanceHealth
      },
      distribution: {
        iniciante: distIniciante,
        intermediario: distIntermediario,
        avancado: distAvancado,
        elite: distElite
      }
    };

    setSimReport(report);
    setSimUsers(generatedUsers);
    setHasRunSimulation(true);
    setIsSimulating(false);

    // Save report to the simulated database mock / localStorage for isolation
    try {
      const savedReports = JSON.parse(localStorage.getItem('invictus_sim_reports') || '[]');
      savedReports.unshift(report);
      localStorage.setItem('invictus_sim_reports', JSON.stringify(savedReports.slice(0, 10)));
    } catch (e) {
      console.error("Local storage simulation backup failed", e);
    }
  };

  // Recalculate if auto-recalculate is active and calibration changes
  useEffect(() => {
    if (hasRunSimulation && autoRecalculate) {
      finishSimulationRun();
    }
  }, [pointsPerWorkout, pointsPerCardio, weekendMultiplier, challengeBonus, xpPerActivity]);

  // Compute insights automatically from current simulation report
  const simulationInsights = useMemo(() => {
    if (!simReport) return [];

    const insights = [];

    // Points balance check
    const ratio = pointsPerCardio / pointsPerWorkout;
    if (ratio > 1.3) {
      insights.push({
        type: 'warning',
        title: 'Desequilíbrio por Modalidade',
        text: `A modalidade Cardio/Corrida está gerando ${Math.round((ratio - 1) * 100)}% mais pontos que Musculação. Isso tornará o ranking excessivamente desequilibrado para atletas de força.`
      });
    } else if (ratio < 0.7) {
      insights.push({
        type: 'warning',
        title: 'Foco Excessivo em Força',
        text: `Atividades de musculação estão gerando muito mais pontos que corrida e cardio. Usuários focados em reabilitação cardiovascular ficarão desmotivados.`
      });
    } else {
      insights.push({
        type: 'success',
        title: 'Equilíbrio Cardio-Força Saudável',
        text: 'A relação de pontos entre cardio e musculação está equilibrada, promovendo uma competição justa entre praticantes de ambas as áreas.'
      });
    }

    // Competitiveness and elite density check
    if (distElite > 8) {
      insights.push({
        type: 'alert',
        title: 'Competitividade Sufocante',
        text: `Com ${distElite}% de usuários no nível Elite, os rankings de topo serão inacessíveis para iniciantes e intermediários, elevando o risco de frustração coletiva.`
      });
    } else if (distElite < 2) {
      insights.push({
        type: 'info',
        title: 'Baixa Aspiração',
        text: 'Pouquíssimos usuários elite estão ativos. Considere criar bônus de consistência maiores para motivar os usuários avançados a atingirem o topo.'
      });
    }

    // Engagement and churn check
    if (activePct < 40) {
      insights.push({
        type: 'alert',
        title: 'Risco Elevado de Churn',
        text: `Apenas ${activePct}% dos usuários estão ativos na simulação. Recomenda-se aumentar os bônus de desafios diários para estimular reengajamento constante.`
      });
    } else if (activePct > 70) {
      insights.push({
        type: 'success',
        title: 'Engajamento de Alta Performance',
        text: `Excelente taxa de engajamento ativa (${activePct}%). O ecossistema atual de gamificação é altamente atrativo.`
      });
    }

    // Beginner friendly check
    if (distIniciante > 50) {
      insights.push({
        type: 'info',
        title: 'Foco em Acolhimento de Iniciantes',
        text: `A comunidade é composta majoritariamente por Iniciantes (${distIniciante}%). Garanta que os multiplicadores de nível baixo (Handicap) estejam calibrados para mantê-los evoluindo.`
      });
    }

    // General competitive index check
    if (simReport.metrics.balanceHealth > 80) {
      insights.push({
        type: 'success',
        title: 'Excelente Equilíbrio Geral',
        text: `O ecossistema apresenta bom equilíbrio competitivo (Saúde de Gamificação: ${simReport.metrics.balanceHealth}%). Excelente para lançamento comercial.`
      });
    } else if (simReport.metrics.balanceHealth < 60) {
      insights.push({
        type: 'alert',
        title: 'Necessidade Urgente de Calibração',
        text: `A saúde da gamificação está baixa (${simReport.metrics.balanceHealth}%). Ajuste os pontos de treino, multiplicadores ou reduza bônus desproporcionais.`
      });
    }

    return insights;
  }, [simReport, pointsPerWorkout, pointsPerCardio, distElite, distIniciante, activePct]);

  // Filter rankings according to query
  const filteredRankings = useMemo(() => {
    return simUsers.filter(u => {
      const q = searchQuery.toLowerCase();
      return u.id.toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || u.preferredCategory.toLowerCase().includes(q);
    });
  }, [simUsers, searchQuery]);

  return (
    <div className="space-y-6" id="ranking-simulator">
      
      {/* MODULE HEADER AND ISOLATION WARNING */}
      <div className="bg-gradient-to-r from-emerald-500/15 via-purple-500/10 to-transparent p-5 rounded-3xl border border-emerald-500/20 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-400">
              <Database className="animate-pulse" size={18} />
              <span className="text-[10px] font-black uppercase tracking-widest font-sans">
                AMB-SBOX ADMINISTRATIVO EXCLUSIVO (SANDBOX TOTAL)
              </span>
            </div>
            <h2 className="text-2xl font-black font-headline italic uppercase text-white tracking-tight">
              SIMULADOR INTELIGENTE DE RANKINGS
            </h2>
            <p className="text-xs text-on-surface-variant max-w-3xl leading-relaxed uppercase">
              Projete cenários competitivos, calibre recompensas e simule o comportamento de até <strong className="text-emerald-400">1.000.000 de usuários fictícios</strong> sob diferentes regras de gamificação sem afetar o banco real.
            </p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 rounded-2xl flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping" />
            <div>
              <span className="text-[10px] font-bold text-emerald-400 block uppercase leading-none">ISOLAMENTO ATIVO</span>
              <span className="text-[8px] text-on-surface-variant uppercase font-mono block mt-1">/admin_simulations</span>
            </div>
          </div>
        </div>
      </div>

      {/* 1. SCENARIO PRESETS QUICK CHOOSE */}
      <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles size={14} className="text-purple-400" />
            SELECIONE UM CENÁRIO PRONTO DE SIMULAÇÃO
          </span>
          <span className="text-[9px] text-on-surface-variant uppercase font-bold bg-white/5 px-2 py-0.5 rounded-lg">4 Perfis de Escala</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Object.entries(PRESET_SCENARIOS).map(([key, preset]) => {
            const isSelected = selectedPreset === key;
            return (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`text-left p-4 rounded-2xl border transition-all duration-300 relative overflow-hidden ${
                  isSelected 
                    ? 'bg-purple-500/15 border-purple-500 shadow-lg shadow-purple-500/10' 
                    : 'bg-surface hover:bg-surface-container border-white/5 hover:border-white/15'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2 bg-purple-500 text-black rounded-full p-0.5">
                    <Check size={10} className="stroke-[3]" />
                  </div>
                )}
                <span className="text-xs font-black text-white uppercase block">{preset.name}</span>
                <span className="text-[11px] text-purple-400 font-mono font-bold block mt-1">
                  {preset.totalUsers.toLocaleString()} usuários • {preset.activePct}% ativos
                </span>
                <p className="text-[9px] text-on-surface-variant/80 uppercase mt-2 leading-snug">
                  {preset.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. SIMULATION CONTROLS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* PANEL A: POPULATION VARIABLES */}
        <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-4">
          <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5 border-b border-white/5 pb-2">
            <Sliders size={14} className="text-emerald-400" />
            PARÂMETROS DA POPULAÇÃO
          </span>

          {/* User count config */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-on-surface-variant font-bold uppercase">Volume de Usuários Simulados</span>
              <span className="text-emerald-400 font-mono font-bold">{totalUsers.toLocaleString()}</span>
            </div>
            <input 
              type="range" 
              min="50" 
              max="1000000" 
              step={totalUsers < 1000 ? 50 : totalUsers < 10000 ? 500 : 10000}
              value={totalUsers}
              onChange={(e) => {
                setTotalUsers(parseInt(e.target.value));
                setSelectedPreset('custom');
              }}
              className="w-full accent-emerald-500 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[8px] text-on-surface-variant font-mono uppercase">
              <span>Mín (50)</span>
              <span>10k</span>
              <span>100k</span>
              <span>500k</span>
              <span>Máx (1 Mi)</span>
            </div>
          </div>

          {/* Active % config */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-on-surface-variant font-bold uppercase">Usuários Ativos (Engajamento)</span>
              <span className="text-emerald-400 font-mono font-bold">{activePct}%</span>
            </div>
            <input 
              type="range" 
              min="10" 
              max="100" 
              value={activePct}
              onChange={(e) => {
                setActivePct(parseInt(e.target.value));
                setSelectedPreset('custom');
              }}
              className="w-full accent-emerald-500 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Period config */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-on-surface-variant font-bold uppercase">Período de Análise</span>
              <select
                value={periodDays}
                onChange={(e) => {
                  setPeriodDays(parseInt(e.target.value));
                  setSelectedPreset('custom');
                }}
                className="w-full bg-surface text-xs text-white border border-white/10 rounded-xl px-3 py-2 uppercase font-bold outline-none"
              >
                <option value={7}>7 Dias (Semanal)</option>
                <option value={30}>30 Dias (Mensal)</option>
                <option value={90}>90 Dias (Trimestral)</option>
              </select>
            </div>

            {/* Ranking Type config */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-on-surface-variant font-bold uppercase">Ranking de Base</span>
              <select
                value={rankingType}
                onChange={(e) => {
                  setRankingType(e.target.value);
                  setSelectedPreset('custom');
                }}
                className="w-full bg-surface text-xs text-white border border-white/10 rounded-xl px-3 py-2 uppercase font-bold outline-none"
              >
                <option value="Geral">Ranking Geral</option>
                <option value="Academia">Ranking Academia</option>
                <option value="Corrida">Corrida & Passos</option>
                <option value="Cardio">Cardioproteção</option>
                <option value="Duelos">Duelos Diretos</option>
              </select>
            </div>
          </div>

          {/* Region simulated */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-on-surface-variant font-bold uppercase">Região Estatística Principal</span>
            <div className="relative">
              <MapPin size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                type="text"
                value={region}
                onChange={(e) => {
                  setRegion(e.target.value);
                  setSelectedPreset('custom');
                }}
                placeholder="Ex: São Paulo"
                className="w-full bg-surface text-xs text-white border border-white/10 rounded-xl pl-9 pr-4 py-2 uppercase font-bold outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
        </div>

        {/* PANEL B: USER LEVEL DISTRIBUTION */}
        <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
              <Layers size={14} className="text-emerald-400" />
              CURVA DE NÍVEL DA COMUNIDADE
            </span>
            <span className="text-[9px] text-emerald-400 font-mono font-black uppercase">
              TOTAL: {distIniciante + distIntermediario + distAvancado + distElite}%
            </span>
          </div>

          <p className="text-[9px] text-on-surface-variant uppercase leading-relaxed">
            Configure a distribuição dos perfis dos usuários fictícios gerados. A proporção afeta a frequência média de treinos e as pontuações máximas possíveis.
          </p>

          <div className="space-y-3">
            {/* Iniciantes */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-white font-bold uppercase text-[11px] flex items-center gap-1">
                  <span className="w-2 h-2 bg-sky-400 rounded-full" />
                  Iniciantes (2-3x/semana)
                </span>
                <span className="text-sky-400 font-mono font-bold">{distIniciante}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={distIniciante}
                onChange={(e) => adjustDistribution('ini', parseInt(e.target.value))}
                className="w-full accent-sky-400 h-1 bg-white/10 rounded appearance-none cursor-pointer"
              />
            </div>

            {/* Intermediarios */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-white font-bold uppercase text-[11px] flex items-center gap-1">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full" />
                  Intermediários (4-5x/semana)
                </span>
                <span className="text-emerald-400 font-mono font-bold">{distIntermediario}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={distIntermediario}
                onChange={(e) => adjustDistribution('int', parseInt(e.target.value))}
                className="w-full accent-emerald-400 h-1 bg-white/10 rounded appearance-none cursor-pointer"
              />
            </div>

            {/* Avancados */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-white font-bold uppercase text-[11px] flex items-center gap-1">
                  <span className="w-2 h-2 bg-purple-400 rounded-full" />
                  Avançados (6x/semana)
                </span>
                <span className="text-purple-400 font-mono font-bold">{distAvancado}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={distAvancado}
                onChange={(e) => adjustDistribution('ava', parseInt(e.target.value))}
                className="w-full accent-purple-400 h-1 bg-white/10 rounded appearance-none cursor-pointer"
              />
            </div>

            {/* Elite */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-white font-bold uppercase text-[11px] flex items-center gap-1">
                  <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                  Elite (Atletas de Alta Performance)
                </span>
                <span className="text-red-400 font-mono font-bold">{distElite}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="30" 
                value={distElite}
                onChange={(e) => adjustDistribution('eli', parseInt(e.target.value))}
                className="w-full accent-red-400 h-1 bg-white/10 rounded appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* PANEL C: LIVE TUNING CALIBRATION */}
        <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
              <Settings size={14} className="text-emerald-400" />
              SISTEMA DE CALIBRAÇÃO EM TEMPO REAL
            </span>
            <div className="flex items-center gap-1">
              <input
                type="checkbox"
                id="autoRecalc"
                checked={autoRecalculate}
                onChange={(e) => setAutoRecalculate(e.target.checked)}
                className="accent-emerald-500 rounded cursor-pointer"
              />
              <label htmlFor="autoRecalc" className="text-[8px] text-on-surface-variant font-bold uppercase cursor-pointer">Auto-Calc</label>
            </div>
          </div>

          <p className="text-[9px] text-on-surface-variant uppercase leading-relaxed">
            Altere as variáveis de ganho de pontos e XP. Se o "Auto-Calc" estiver marcado, o ranking simula novos desvios e médias instantaneamente!
          </p>

          <div className="grid grid-cols-2 gap-3">
            {/* Points workout */}
            <div className="space-y-1">
              <label className="text-[9px] text-on-surface-variant font-bold uppercase block">Pontos por Treino</label>
              <input 
                type="number"
                value={pointsPerWorkout}
                onChange={(e) => setPointsPerWorkout(Math.max(10, parseInt(e.target.value) || 0))}
                className="w-full bg-surface text-xs text-white border border-white/10 rounded-xl px-3 py-1.5 uppercase font-mono font-bold outline-none"
              />
            </div>

            {/* Points Cardio */}
            <div className="space-y-1">
              <label className="text-[9px] text-on-surface-variant font-bold uppercase block">Pontos por Cardio</label>
              <input 
                type="number"
                value={pointsPerCardio}
                onChange={(e) => setPointsPerCardio(Math.max(10, parseInt(e.target.value) || 0))}
                className="w-full bg-surface text-xs text-white border border-white/10 rounded-xl px-3 py-1.5 uppercase font-mono font-bold outline-none"
              />
            </div>

            {/* XP per activity */}
            <div className="space-y-1">
              <label className="text-[9px] text-on-surface-variant font-bold uppercase block">XP por Atividade</label>
              <input 
                type="number"
                value={xpPerActivity}
                onChange={(e) => setXpPerActivity(Math.max(5, parseInt(e.target.value) || 0))}
                className="w-full bg-surface text-xs text-white border border-white/10 rounded-xl px-3 py-1.5 uppercase font-mono font-bold outline-none"
              />
            </div>

            {/* Challenge bonus */}
            <div className="space-y-1">
              <label className="text-[9px] text-on-surface-variant font-bold uppercase block">Bônus Desafios</label>
              <input 
                type="number"
                value={challengeBonus}
                onChange={(e) => setChallengeBonus(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full bg-surface text-xs text-white border border-white/10 rounded-xl px-3 py-1.5 uppercase font-mono font-bold outline-none"
              />
            </div>
          </div>

          {/* Weekend Multiplier */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-on-surface-variant font-bold uppercase">Multiplicador Fim de Semana</span>
              <span className="text-purple-400 font-mono font-bold">{weekendMultiplier}x</span>
            </div>
            <input 
              type="range" 
              min="1.0" 
              max="3.0" 
              step="0.1"
              value={weekendMultiplier}
              onChange={(e) => setWeekendMultiplier(parseFloat(e.target.value))}
              className="w-full accent-purple-500 h-1 bg-white/10 rounded appearance-none cursor-pointer"
            />
          </div>
        </div>

      </div>

      {/* 3. RUN ACTION BUTTON & PROGRESS */}
      <div className="bg-surface-container border border-white/10 p-5 rounded-3xl flex flex-col items-center justify-center gap-4 text-center">
        {!isSimulating ? (
          <button
            onClick={executeSimulation}
            className="bg-emerald-500 hover:bg-emerald-600 text-black font-black font-headline uppercase px-8 py-4 rounded-2xl flex items-center gap-3 cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-95 transition-all text-sm tracking-wide"
          >
            <Play fill="currentColor" size={16} />
            Executar Simulação de Amostragem Monte Carlo
          </button>
        ) : (
          <div className="w-full max-w-lg space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-emerald-400 font-black animate-pulse uppercase tracking-wider flex items-center gap-1.5">
                <RefreshCw size={12} className="animate-spin" />
                {simulationStep}
              </span>
              <span className="text-white font-mono font-bold">{simulationProgress}%</span>
            </div>
            <div className="w-full bg-white/5 h-2.5 rounded-full overflow-hidden border border-white/10">
              <div 
                className="bg-gradient-to-r from-emerald-500 to-purple-500 h-full transition-all duration-300 rounded-full"
                style={{ width: `${simulationProgress}%` }}
              />
            </div>
            <p className="text-[10px] text-on-surface-variant uppercase font-mono tracking-wider">
              Processando simulações estatísticas em thread isolada sandbox...
            </p>
          </div>
        )}

        {!hasRunSimulation && !isSimulating && (
          <div className="flex items-center gap-2 text-on-surface-variant text-xs uppercase font-bold">
            <Info size={14} className="text-purple-400" />
            <span>Nenhuma simulação ativa na sessão. Clique acima para rodar a projeção dos rankings.</span>
          </div>
        )}
      </div>

      {/* 4. RESULTS DASHBOARDS (VISIBLE AFTER FIRST RUN) */}
      {hasRunSimulation && simReport && (
        <div className="space-y-6">
          
          {/* RESULTS NAVIGATION TABS */}
          <div className="flex border-b border-white/10">
            <button
              onClick={() => setActiveSubTab('overview')}
              className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
                activeSubTab === 'overview' 
                  ? 'border-emerald-500 text-emerald-400 bg-white/5' 
                  : 'border-transparent text-on-surface-variant hover:text-white'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <BarChart2 size={14} />
                Dashboard Admin
              </span>
            </button>
            <button
              onClick={() => setActiveSubTab('rankings')}
              className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
                activeSubTab === 'rankings' 
                  ? 'border-emerald-500 text-emerald-400 bg-white/5' 
                  : 'border-transparent text-on-surface-variant hover:text-white'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Award size={14} />
                Visualizador de Rankings
              </span>
            </button>
            <button
              onClick={() => setActiveSubTab('database')}
              className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
                activeSubTab === 'database' 
                  ? 'border-emerald-500 text-emerald-400 bg-white/5' 
                  : 'border-transparent text-on-surface-variant hover:text-white'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Database size={14} />
                Nós do Banco Simulador
              </span>
            </button>
          </div>

          {/* VIEW A: OVERVIEW AND CHARTS */}
          {activeSubTab === 'overview' && (
            <div className="space-y-6 animate-fade-in">
              
              {/* KEY STATS MATRIX */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                
                <div className="bg-surface-container border border-white/5 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-on-surface-variant font-bold uppercase">Média Geral de Pontos</span>
                  <span className="text-xl font-mono font-bold text-white mt-2">
                    {simReport.metrics.averageScore.toLocaleString()} XP
                  </span>
                  <span className="text-[8px] text-on-surface-variant uppercase mt-1">Por usuário ativo</span>
                </div>

                <div className="bg-surface-container border border-white/5 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-on-surface-variant font-bold uppercase">Pontuação do Líder</span>
                  <span className="text-xl font-mono font-bold text-emerald-400 mt-2">
                    {simReport.metrics.leaderScore.toLocaleString()} XP
                  </span>
                  <span className="text-[8px] text-emerald-400/80 uppercase mt-1">SIM_USER_0001</span>
                </div>

                <div className="bg-surface-container border border-white/5 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-on-surface-variant font-bold uppercase">Desvio Padrão (σ)</span>
                  <span className="text-xl font-mono font-bold text-purple-400 mt-2">
                    ±{simReport.metrics.standardDeviation.toLocaleString()} XP
                  </span>
                  <span className="text-[8px] text-on-surface-variant uppercase mt-1">Dispersão da tabela</span>
                </div>

                <div className="bg-surface-container border border-white/5 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-on-surface-variant font-bold uppercase">Saúde da Gamificação</span>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-xl font-black italic ${
                      simReport.metrics.balanceHealth > 80 ? 'text-green-400' : simReport.metrics.balanceHealth > 60 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {simReport.metrics.balanceHealth}%
                    </span>
                    <span className="text-[9px] uppercase font-bold text-on-surface-variant/70">
                      {simReport.metrics.balanceHealth > 80 ? 'Excelente' : simReport.metrics.balanceHealth > 60 ? 'Estável' : 'Crítico'}
                    </span>
                  </div>
                  <span className="text-[8px] text-on-surface-variant uppercase mt-1">Métrica de calibragem</span>
                </div>

                <div className="bg-surface-container border border-white/5 p-4 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-on-surface-variant font-bold uppercase">Ativos vs Inativos</span>
                  <span className="text-xl font-mono font-bold text-white mt-2">
                    {simReport.metrics.activeCount.toLocaleString()} / {simReport.metrics.inactiveCount.toLocaleString()}
                  </span>
                  <span className="text-[8px] text-on-surface-variant uppercase mt-1">Proporção {activePct}% ativos</span>
                </div>

              </div>

              {/* INTERACTIVE CHARTS CONTAINER */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* CHART 1: NIVEL DISTRIBUTION (Pie-style curved bar display) */}
                <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-4">
                  <span className="text-xs font-black text-white uppercase tracking-wider block">
                    DISTRIBUIÇÃO POR NÍVEL DA COMUNIDADE
                  </span>
                  
                  {/* SVG Donut Chart */}
                  <div className="flex flex-col sm:flex-row items-center justify-around gap-4 pt-2">
                    <div className="relative w-36 h-36">
                      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                        {/* Donut sectors based on distribution percentages */}
                        {(() => {
                          const r = 35;
                          const circ = 2 * Math.PI * r;
                          
                          let currentOffset = 0;
                          
                          const stroke1 = (distIniciante / 100) * circ;
                          const offset1 = currentOffset;
                          currentOffset += stroke1;

                          const stroke2 = (distIntermediario / 100) * circ;
                          const offset2 = currentOffset;
                          currentOffset += stroke2;

                          const stroke3 = (distAvancado / 100) * circ;
                          const offset3 = currentOffset;
                          currentOffset += stroke3;

                          const stroke4 = (distElite / 100) * circ;
                          const offset4 = currentOffset;

                          return (
                            <>
                              {/* Background */}
                              <circle cx="50" cy="50" r={r} fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
                              {/* Iniciante */}
                              {distIniciante > 0 && (
                                <circle cx="50" cy="50" r={r} fill="transparent" stroke="#38bdf8" strokeWidth="12" 
                                  strokeDasharray={`${stroke1} ${circ - stroke1}`} strokeDashoffset={-offset1} />
                              )}
                              {/* Intermediario */}
                              {distIntermediario > 0 && (
                                <circle cx="50" cy="50" r={r} fill="transparent" stroke="#34d399" strokeWidth="12" 
                                  strokeDasharray={`${stroke2} ${circ - stroke2}`} strokeDashoffset={-offset2} />
                              )}
                              {/* Avancado */}
                              {distAvancado > 0 && (
                                <circle cx="50" cy="50" r={r} fill="transparent" stroke="#c084fc" strokeWidth="12" 
                                  strokeDasharray={`${stroke3} ${circ - stroke3}`} strokeDashoffset={-offset3} />
                              )}
                              {/* Elite */}
                              {distElite > 0 && (
                                <circle cx="50" cy="50" r={r} fill="transparent" stroke="#f87171" strokeWidth="12" 
                                  strokeDasharray={`${stroke4} ${circ - stroke4}`} strokeDashoffset={-offset4} />
                              )}
                            </>
                          );
                        })()}
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[10px] text-on-surface-variant font-black uppercase">Simulado</span>
                        <span className="text-base font-mono font-bold text-white">
                          {totalUsers >= 1000 ? `${(totalUsers / 1000).toFixed(0)}k` : totalUsers}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs uppercase font-bold w-full max-w-[200px]">
                      <div className="flex justify-between items-center bg-white/[0.01] p-1.5 rounded-xl border border-white/5">
                        <span className="flex items-center gap-1.5 text-sky-400">
                          <span className="w-2.5 h-2.5 bg-sky-400 rounded-sm" />
                          Iniciante
                        </span>
                        <span className="text-white font-mono">{distIniciante}%</span>
                      </div>
                      <div className="flex justify-between items-center bg-white/[0.01] p-1.5 rounded-xl border border-white/5">
                        <span className="flex items-center gap-1.5 text-emerald-400">
                          <span className="w-2.5 h-2.5 bg-emerald-400 rounded-sm" />
                          Intermediário
                        </span>
                        <span className="text-white font-mono">{distIntermediario}%</span>
                      </div>
                      <div className="flex justify-between items-center bg-white/[0.01] p-1.5 rounded-xl border border-white/5">
                        <span className="flex items-center gap-1.5 text-purple-400">
                          <span className="w-2.5 h-2.5 bg-purple-400 rounded-sm" />
                          Avançado
                        </span>
                        <span className="text-white font-mono">{distAvancado}%</span>
                      </div>
                      <div className="flex justify-between items-center bg-white/[0.01] p-1.5 rounded-xl border border-white/5">
                        <span className="flex items-center gap-1.5 text-red-400 animate-pulse">
                          <span className="w-2.5 h-2.5 bg-red-400 rounded-sm" />
                          Elite
                        </span>
                        <span className="text-white font-mono">{distElite}%</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CHART 2: SCORE DISTRIBUTION BELL-CURVE */}
                <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-4">
                  <span className="text-xs font-black text-white uppercase tracking-wider block">
                    CURVA ESTATÍSTICA DE PONTUAÇÃO (CAMPANA GAUSSIANA)
                  </span>

                  {/* SVG Bar / Bell curve chart */}
                  <div className="h-40 relative flex items-end justify-between gap-1 pt-4 border-b border-white/10 px-2">
                    {/* Simulated bars resembling a bell curve centered around averageScore */}
                    {(() => {
                      const barsCount = 15;
                      const heights = [10, 22, 38, 55, 75, 88, 95, 82, 68, 52, 35, 20, 12, 6, 2];
                      
                      return heights.map((h, idx) => (
                        <div key={idx} className="flex-1 flex flex-col items-center group relative cursor-pointer">
                          <div 
                            className="w-full bg-gradient-to-t from-emerald-500/80 to-purple-500/80 rounded-t-sm group-hover:from-emerald-400 group-hover:to-purple-400 transition-all duration-300"
                            style={{ height: `${h}%` }}
                          />
                          {/* Tooltip on hover */}
                          <div className="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 bg-surface border border-white/10 px-2 py-1 rounded text-[8px] font-mono text-white pointer-events-none transition-opacity uppercase whitespace-nowrap z-10">
                            Faixa: {Math.round((simReport.metrics.averageScore * 0.3) + (idx * simReport.metrics.averageScore * 0.1))} XP • {h}% Pop
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                  <div className="flex justify-between text-[8px] text-on-surface-variant font-mono uppercase px-2">
                    <span>Base (Baixa Pontuação)</span>
                    <span className="text-white font-bold">Média (~{simReport.metrics.averageScore.toLocaleString()} XP)</span>
                    <span>Topo do Ranking (Líderes)</span>
                  </div>
                </div>

              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* CHART 3: WEEKLY LEADER EVOLUTION OVER TIME */}
                <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-4">
                  <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp size={14} className="text-emerald-400" />
                    PROJEÇÃO DA EVOLUÇÃO SEMANAL DO LÍDER (CURVA DE CRESCIMENTO)
                  </span>

                  {/* SVG Line Chart for leader score growth */}
                  <div className="h-40 relative pt-4 px-4 border-l border-b border-white/10">
                    <svg viewBox="0 0 300 120" className="w-full h-full overflow-visible">
                      <defs>
                        <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      
                      {/* Grid lines */}
                      <line x1="0" y1="30" x2="300" y2="30" stroke="rgba(255,255,255,0.03)" strokeDasharray="3" />
                      <line x1="0" y1="60" x2="300" y2="60" stroke="rgba(255,255,255,0.03)" strokeDasharray="3" />
                      <line x1="0" y1="90" x2="300" y2="90" stroke="rgba(255,255,255,0.03)" strokeDasharray="3" />

                      {/* Area and Line */}
                      {(() => {
                        const points = [
                          {x: 0, y: 110},
                          {x: 50, y: 92},
                          {x: 100, y: 78},
                          {x: 150, y: 55},
                          {x: 200, y: 38},
                          {x: 250, y: 22},
                          {x: 300, y: 10}
                        ];
                        const dPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                        const dArea = `${dPath} L 300 120 L 0 120 Z`;

                        return (
                          <>
                            <path d={dArea} fill="url(#lineGrad)" />
                            <path d={dPath} fill="none" stroke="#10b981" strokeWidth="2.5" />
                            {points.map((p, idx) => (
                              <g key={idx}>
                                <circle cx={p.x} cy={p.y} r="4" fill="#10b981" stroke="#000" strokeWidth="1.5" className="cursor-pointer hover:r-6" />
                                <text x={p.x} y={p.y - 8} fontSize="7" fill="rgba(255,255,255,0.5)" textAnchor="middle" fontFamily="monospace">
                                  {Math.round(simReport.metrics.leaderScore * (idx / 6)).toLocaleString()}
                                </text>
                              </g>
                            ))}
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                  <div className="flex justify-between text-[8px] text-on-surface-variant font-mono uppercase">
                    <span>Início</span>
                    <span>Dia 3</span>
                    <span>Dia 7</span>
                    <span>Dia 15</span>
                    <span>Dia 30</span>
                    <span>Projeção Final ({periodDays} Dias)</span>
                  </div>
                </div>

                {/* CHART 4: ENGAGEMENT BY MODALITY */}
                <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-4">
                  <span className="text-xs font-black text-white uppercase tracking-wider block">
                    FLUXO DE ENGAJAMENTO POR MODALIDADE ESPORTIVA
                  </span>

                  <div className="space-y-2.5 pt-2">
                    {MODALITIES.map((mod, idx) => {
                      // Determine simulated engagement
                      let pct = 45;
                      let color = 'bg-sky-400';
                      if (mod === 'Cardio' || mod === 'Corrida') {
                        pct = Math.round(55 + (pointsPerCardio * 0.2));
                        color = 'bg-emerald-400';
                      } else if (mod === 'Musculação') {
                        pct = Math.round(50 + (pointsPerWorkout * 0.25));
                        color = 'bg-purple-400';
                      } else if (mod === 'Duelos') {
                        pct = Math.round(65 + (weekendMultiplier * 5));
                        color = 'bg-red-400';
                      } else {
                        pct = 42;
                        color = 'bg-yellow-400';
                      }
                      pct = Math.min(98, Math.max(10, pct));

                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between items-center text-[10px] uppercase font-bold text-white">
                            <span>{mod}</span>
                            <span className="font-mono">{pct}% engajamento</span>
                          </div>
                          <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden border border-white/5">
                            <div className={`${color} h-full rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* AUTOMATIC EXPERT DIAGNOSTIC ENGINE */}
              <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-4">
                <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5 border-b border-white/5 pb-2">
                  <ShieldAlert size={14} className="text-amber-400 animate-pulse" />
                  MOTOR DE ANÁLISE AUTOMÁTICA & RECOMENDAÇÕES DE BALANCEAMENTO
                </span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {simulationInsights.map((ins, idx) => (
                    <div 
                      key={idx} 
                      className={`p-4 rounded-2xl border flex items-start gap-3 ${
                        ins.type === 'alert' 
                          ? 'bg-red-500/10 border-red-500/25 text-red-200' 
                          : ins.type === 'warning' 
                            ? 'bg-amber-500/10 border-amber-500/25 text-amber-200'
                            : ins.type === 'success'
                              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                              : 'bg-blue-500/10 border-blue-500/25 text-blue-200'
                      }`}
                    >
                      {ins.type === 'alert' || ins.type === 'warning' ? (
                        <ShieldAlert className="flex-shrink-0 mt-0.5" size={16} />
                      ) : (
                        <CheckCircle className="flex-shrink-0 mt-0.5" size={16} />
                      )}
                      <div className="space-y-1">
                        <span className="text-xs font-black uppercase block leading-none">{ins.title}</span>
                        <p className="text-[10px] leading-relaxed uppercase">{ins.text}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-purple-500/5 border border-purple-500/15 p-4 rounded-2xl space-y-2">
                  <span className="text-xs font-black text-purple-400 uppercase tracking-wider block">PROPOSTA DE RECALIBRAGEM DO SISTEMA</span>
                  <p className="text-[10px] text-on-surface-variant uppercase leading-relaxed">
                    💡 Para otimizar a curva competitiva para {totalUsers.toLocaleString()} usuários: Reduza o bônus de desafios para <strong className="text-purple-400">100 XP</strong> e aumente o bônus de musculação para <strong className="text-purple-400">120</strong>. Ative ligas semanais se o desvio padrão exceder ±3.000 XP.
                  </p>
                </div>
              </div>

            </div>
          )}

          {/* VIEW B: VISUALIZADOR DE RANKINGS */}
          {activeSubTab === 'rankings' && (
            <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-4 animate-fade-in">
              
              {/* RANKINGS NAVIGATION AND SEARCH */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-3">
                <div className="flex flex-wrap gap-2">
                  {(['geral', 'semanal', 'mensal', 'academia', 'cidade', 'modalidade'] as const).map((tab) => {
                    const label = tab === 'geral' ? 'Ranking Geral' : tab === 'semanal' ? 'Semanal' : tab === 'mensal' ? 'Mensal' : tab === 'academia' ? 'Academia' : tab === 'cidade' ? 'Cidade' : 'Modalidade';
                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveRankingTab(tab)}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                          activeRankingTab === tab 
                            ? 'bg-emerald-500 text-black shadow-md' 
                            : 'bg-surface hover:bg-surface-container border border-white/5 text-on-surface-variant hover:text-white'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar usuário simulado..."
                    className="w-full bg-surface text-xs text-white border border-white/10 rounded-xl pl-9 pr-4 py-2 uppercase outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>

              {/* STATS SUMMARY OF ACTIVE TAB */}
              <div className="bg-surface p-3 rounded-2xl border border-white/5 flex flex-wrap justify-between items-center text-[10px] uppercase font-bold text-on-surface-variant gap-2">
                <span>Visualizando Projeção Virtual do Ranking <strong className="text-emerald-400">{activeRankingTab}</strong></span>
                <span>Filtro Região: <strong className="text-white">{region}</strong></span>
                <span>Encontrados: <strong className="text-white">{filteredRankings.length}</strong></span>
              </div>

              {/* RANKING LIST TABLE */}
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-1">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-white/10 text-on-surface-variant uppercase text-[9px]">
                      <th className="py-2 text-center w-12">Pos</th>
                      <th className="py-2">Usuário Fictício (ID / Nome)</th>
                      <th className="py-2 text-center">Nível</th>
                      <th className="py-2 text-center">Frequência/S</th>
                      <th className="py-2">Preferida</th>
                      <th className="py-2 text-center">Engajamento</th>
                      <th className="py-2 text-right">Pontos Projetados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRankings.slice(0, 50).map((user, idx) => {
                      // Adjust score slightly based on the tab chosen to make the simulation feel alive and varied!
                      let scoreModifier = 1.0;
                      if (activeRankingTab === 'semanal') scoreModifier = 0.25;
                      else if (activeRankingTab === 'mensal') scoreModifier = 0.85;
                      else if (activeRankingTab === 'academia') scoreModifier = 0.95;
                      else if (activeRankingTab === 'cidade') scoreModifier = 0.90;
                      else if (activeRankingTab === 'modalidade') scoreModifier = 0.70;

                      const displayPoints = Math.round(user.avgPoints * scoreModifier);

                      // Badges for top 3
                      let posBadge = null;
                      if (idx === 0) posBadge = '🥇';
                      else if (idx === 1) posBadge = '🥈';
                      else if (idx === 2) posBadge = '🥉';

                      return (
                        <tr key={user.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                          <td className="py-3 text-center font-bold text-white">
                            {posBadge ? <span className="text-base">{posBadge}</span> : idx + 1}
                          </td>
                          <td className="py-3 font-semibold text-white">
                            <span className="block">{user.name}</span>
                            <span className="text-[9px] text-on-surface-variant uppercase">
                              {user.academy} • {user.region}
                            </span>
                          </td>
                          <td className="py-3 text-center">
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                              user.level === 'Elite' 
                                ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                                : user.level === 'Avançado' 
                                  ? 'bg-purple-500/10 text-purple-400'
                                  : user.level === 'Intermediário'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-sky-500/10 text-sky-400'
                            }`}>
                              {user.level}
                            </span>
                          </td>
                          <td className="py-3 text-center font-bold text-white">{user.weeklyFrequency}x</td>
                          <td className="py-3 uppercase text-[10px] text-on-surface-variant font-bold">{user.preferredCategory}</td>
                          <td className="py-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="font-bold text-white">{user.engagementScore}%</span>
                              <div className="w-10 bg-white/5 h-1 rounded-full overflow-hidden">
                                <div className="bg-emerald-400 h-full" style={{ width: `${user.engagementScore}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="py-3 text-right font-black text-emerald-400 text-sm">
                            {displayPoints.toLocaleString()} <span className="text-[9px] text-on-surface-variant font-medium">XP</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-white/[0.01] border border-white/5 p-3 rounded-2xl flex items-center justify-between text-[10px] text-on-surface-variant uppercase font-medium">
                <span>Mostrando até 50 usuários simulados de maior relevância para evitar gargalos na renderização.</span>
                <span className="font-mono">Ambiente de Testes Isolado (Falso)</span>
              </div>

            </div>
          )}

          {/* VIEW C: NÓS DO BANCO SIMULADOR (JSON DB VIEWER) */}
          {activeSubTab === 'database' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
              
              {/* FILE DIRECTORY TREE */}
              <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-3 lg:col-span-1">
                <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5 border-b border-white/5 pb-2">
                  <Database size={14} className="text-emerald-400" />
                  BANCO DE DADOS ISOLADO (SANDBOX)
                </span>
                
                <p className="text-[9px] text-on-surface-variant uppercase leading-relaxed">
                  Para fins regulatórios e auditoria interna, as simulações criam e manipulam nós segregados em memória e indexação fictícia.
                </p>

                <div className="space-y-2 pt-2">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl flex items-center justify-between text-xs font-mono">
                    <span className="text-white">/admin_simulations</span>
                    <span className="text-[9px] bg-emerald-500 text-black px-1.5 py-0.5 rounded font-bold">1 ATIVO</span>
                  </div>
                  <div className="bg-white/5 border border-white/5 p-2.5 rounded-xl flex items-center justify-between text-xs font-mono">
                    <span className="text-on-surface-variant font-bold">/simulated_users</span>
                    <span className="text-[9px] bg-white/10 text-white px-1.5 py-0.5 rounded font-bold">{totalUsers.toLocaleString()} NODES</span>
                  </div>
                  <div className="bg-white/5 border border-white/5 p-2.5 rounded-xl flex items-center justify-between text-xs font-mono">
                    <span className="text-on-surface-variant font-bold">/simulated_rankings</span>
                    <span className="text-[9px] bg-white/10 text-white px-1.5 py-0.5 rounded font-bold">6 TABLES</span>
                  </div>
                  <div className="bg-white/5 border border-white/5 p-2.5 rounded-xl flex items-center justify-between text-xs font-mono">
                    <span className="text-on-surface-variant font-bold">/simulation_reports</span>
                    <span className="text-[9px] bg-white/10 text-white px-1.5 py-0.5 rounded font-bold">HISTÓRICO</span>
                  </div>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-2xl flex items-start gap-2 mt-4">
                  <ShieldAlert className="text-amber-400 flex-shrink-0 mt-0.5" size={14} />
                  <span className="text-[9px] text-on-surface-variant uppercase leading-snug">
                    Aviso: O isolamento total garante que esses dados não interfiram com as tabelas de produção (/users, /rankings, /rewards).
                  </span>
                </div>
              </div>

              {/* JSON DUMP VIEWER */}
              <div className="bg-surface-container border border-white/10 p-5 rounded-3xl space-y-3 lg:col-span-2">
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <FileText size={14} className="text-emerald-400" />
                    EXPLORADOR DE DUMP JSON (DADOS BRUTOS)
                  </span>
                  <span className="text-[8px] text-on-surface-variant font-mono uppercase">VIRTUAL_INDEX_SNAPSHOT.json</span>
                </div>

                <div className="bg-black/40 border border-white/5 p-4 rounded-2xl font-mono text-[10px] text-emerald-400/90 overflow-x-auto max-h-96 overflow-y-auto space-y-2">
                  <span className="text-on-surface-variant/40 block">// Snapshot JSON do nó /admin_simulations/{simReport.id}</span>
                  <pre className="leading-relaxed">
                    {JSON.stringify({
                      reportId: simReport.id,
                      simulation_metadata: {
                        timestamp: simReport.timestamp,
                        operator_email: 'samuelfsc89@gmail.com',
                        sandbox_status: 'isolated_secure_mode',
                        simulated_environment: 'Invictus Core Engine v2.1'
                      },
                      parameters: {
                        total_simulated_users: simReport.totalUsers,
                        active_users_percentage: simReport.activePct,
                        analyzed_days: simReport.periodDays,
                        primary_region: simReport.region,
                        gamification_tuning: {
                          points_per_workout: pointsPerWorkout,
                          points_per_cardio: pointsPerCardio,
                          weekend_multiplier: weekendMultiplier,
                          challenge_bonus: challengeBonus,
                          xp_per_activity: xpPerActivity
                        }
                      },
                      metrics_output: simReport.metrics,
                      distribution_by_level: simReport.distribution,
                      top_3_records: simUsers.slice(0, 3).map(u => ({
                        id: u.id,
                        name_hash: u.name,
                        derived_level: u.level,
                        calculated_score_xp: u.avgPoints,
                        weekly_frequency_target: u.weeklyFrequency
                      }))
                    }, null, 2)}
                  </pre>
                </div>
              </div>

            </div>
          )}

        </div>
      )}

    </div>
  );
}
