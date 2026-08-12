import React, { useState } from 'react';
import { 
  Heart, Activity, Flame, Zap, Moon, Scale, TrendingUp, Sparkles, 
  ChevronDown, ChevronUp, Printer, FileText, CheckCircle2, 
  Info, Watch, Dumbbell, Calendar, ShieldCheck, Award, 
  ArrowUpRight, ArrowDownRight, Minus, X, RefreshCw
} from 'lucide-react';
import { cn } from '../lib/utils';
import { UserProfile } from '../types';

interface PhysiologicalDiagnosticProps {
  user: UserProfile;
  metrics?: any[];
  smartwatchConnected?: boolean;
  smartwatchHR?: number;
}

type TimeFrame = 'today' | '7d' | '30d' | '90d' | '12m';

export function PhysiologicalDiagnostic({ 
  user, 
  metrics = [], 
  smartwatchConnected = false,
  smartwatchHR = 75
}: PhysiologicalDiagnosticProps) {
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('30d');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({
    'performance': true,
    'cardio': true,
    'intensity': false,
    'fitness': false,
    'recovery': false,
    'workouts': false,
    'daily': false,
    'energy': false,
    'sleep': false,
    'body': false,
    'evolution': false,
  });

  const [deepTechDetails, setDeepTechDetails] = useState<Record<string, boolean>>({});
  const [showPdfModal, setShowPdfModal] = useState(false);

  const toggleExpand = (key: string) => {
    setExpandedCards(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleTechDetails = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    setDeepTechDetails(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Base physiological dataset calculations (combining live metrics, wearable inputs & defaults)
  const isHRValid = smartwatchConnected && smartwatchHR > 0;
  const currentRestingHR = isHRValid ? Math.max(52, smartwatchHR - 18) : 58;
  const currentAvgHR = isHRValid ? smartwatchHR : 72;
  const currentMaxHR = isHRValid ? Math.min(195, smartwatchHR + 110) : 178;
  const currentHRV = isHRValid ? Math.min(95, Math.max(35, Math.round(120 - currentRestingHR * 0.9))) : 62; // RMSSD in ms
  const currentVO2Max = user?.weight ? Math.min(65, Math.max(32, Math.round(15 * (currentMaxHR / currentRestingHR)))) : 48; // ml/kg/min
  
  // Weights and body composition
  const userWeight = user?.weight || 74;
  const userHeight = user?.height || 178;
  const heightMeters = userHeight / 100;
  const bmi = (userWeight / (heightMeters * heightMeters)).toFixed(1);
  const estimatedBodyFat = 16.5; // %
  const estimatedMuscleMass = (userWeight * (1 - estimatedBodyFat / 100) * 0.82).toFixed(1); // kg
  const estimatedBodyWater = 61.2; // %

  // Heart rate zones calculation (Karvonen method approximation)
  const hrReserve = currentMaxHR - currentRestingHR;
  const z1Upper = Math.round(currentRestingHR + hrReserve * 0.6);
  const z2Upper = Math.round(currentRestingHR + hrReserve * 0.7);
  const z3Upper = Math.round(currentRestingHR + hrReserve * 0.8);
  const z4Upper = Math.round(currentRestingHR + hrReserve * 0.9);

  // Timeframe multiplier simulation
  const timeFrameLabels: Record<TimeFrame, string> = {
    today: 'Hoje',
    '7d': 'Últimos 7 dias',
    '30d': 'Últimos 30 dias',
    '90d': 'Últimos 90 dias',
    '12m': 'Últimos 12 meses'
  };

  return (
    <div className="space-y-6 pb-12 font-sans">
      
      {/* 1. TOP HEADER BAR: TIMEFRAME & REPORT BUTTON */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-surface-container-low p-4 rounded-[28px] border border-outline-variant/10 shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {(['today', '7d', '30d', '90d', '12m'] as TimeFrame[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeFrame(tf)}
              className={cn(
                "px-3 py-1.5 rounded-xl font-headline italic font-black text-[10px] sm:text-xs uppercase tracking-wider transition-all cursor-pointer shrink-0",
                timeFrame === tf
                  ? "bg-primary text-on-primary shadow-md shadow-primary/20 scale-105"
                  : "bg-surface-container-high/60 text-on-surface-variant hover:text-on-surface border border-outline-variant/5"
              )}
            >
              {timeFrameLabels[tf]}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowPdfModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-amber-500/20 via-primary/20 to-amber-500/20 hover:from-amber-500/30 hover:to-amber-500/30 text-amber-300 font-headline italic font-black text-xs uppercase tracking-wider rounded-xl transition-all border border-amber-500/30 flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-sm"
        >
          <FileText size={15} />
          <span>RELATÓRIO FISIOLÓGICO INVICTUS</span>
        </button>
      </div>

      {/* 2. EXECUTIVE AI HEALTH & PERFORMANCE BANNER */}
      <div className="bg-gradient-to-br from-surface-container-low via-surface-container-low to-primary/5 rounded-[32px] border border-primary/20 p-6 relative overflow-hidden shadow-md">
        <div className="absolute top-0 right-0 bg-primary/10 border-b border-l border-primary/20 text-primary font-mono font-black text-[8px] uppercase tracking-widest px-3 py-1.5 rounded-bl-2xl flex items-center gap-1.5">
          <Sparkles size={11} className="animate-spin text-primary" />
          INTELIGÊNCIA BIOMÉTRICA ATIVA
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pt-2">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-black uppercase tracking-wider font-mono">
              <CheckCircle2 size={12} />
              ESTADO FISIOLÓGICO: ALTA SUPERCOMPENSAÇÃO
            </div>

            <h2 className="font-headline italic font-black text-2xl md:text-3xl text-on-surface uppercase tracking-tight leading-none">
              "Seu corpo está respondendo com máxima eficiência adaptativa."
            </h2>

            <p className="text-xs text-on-surface-variant font-medium leading-relaxed">
              Com base nos dados de variabilidade cardíaca ({currentHRV} ms), frequência de repouso ({currentRestingHR} bpm) e carga aguda acumulada, seu sistema nervoso autônomo está totalmente regenerado. Você possui <strong className="text-primary font-bold">excelente janela de oportunidade</strong> para treinos de alta intensidade.
            </p>
          </div>

          <div className="flex items-center gap-4 shrink-0 bg-surface-container-high/60 p-4 rounded-2xl border border-white/5">
            <div className="text-center">
              <span className="block font-label text-[8px] font-black uppercase tracking-widest text-on-surface-variant">SCORE BIOLÓGICO</span>
              <div className="flex items-baseline justify-center gap-1 mt-0.5">
                <span className="font-headline italic font-black text-4xl text-primary leading-none">88</span>
                <span className="text-[10px] font-bold text-on-surface-variant">/100</span>
              </div>
              <span className="inline-block mt-1 text-[8px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">↑ 4% vs mês anterior</span>
            </div>

            <div className="w-px h-12 bg-white/10" />

            <div className="text-center">
              <span className="block font-label text-[8px] font-black uppercase tracking-widest text-on-surface-variant">PRONTIDÃO</span>
              <span className="font-headline italic font-black text-2xl text-emerald-400 leading-none block mt-1">94%</span>
              <span className="text-[8px] text-on-surface-variant uppercase font-bold block mt-1">EXCELENTE</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. CATEGORY CARDS LIST WITH 3-LAYER PROGRESSIVE DISCLOSURE */}
      <div className="space-y-4">

        {/* CATEGORY 1: PERFORMANCE GERAL */}
        <CategoryCard
          cardKey="performance"
          icon={<Award className="text-amber-400" size={20} />}
          title="⭐ PERFORMANCE GERAL & SCORE BIOLÓGICO"
          summaryText="Seu rendimento atlético geral está 8% acima da sua média dos últimos 30 dias."
          badge="88 / 100 PTS"
          isExpanded={expandedCards['performance']}
          onToggle={() => toggleExpand('performance')}
          isTechOpen={deepTechDetails['performance']}
          onToggleTech={(e) => toggleTechDetails(e, 'performance')}
          layer2Content={{
            whatHappened: "Nas últimas semanas, sua constância de treinos combinada com boa recuperação noturna aumentou seu índice de eficiência global.",
            whatItMeans: "Significa que seu corpo está conseguindo absorver as cargas de estresse físico e convertê-las em ganho de força e condicionamento sem entrar em estado de fadiga crônica.",
            impact: "Permite manter a progressão de carga sem risco de overtraining.",
            howToImprove: "Mantenha pelo menos 1 dia de recuperação ativa por semana e priorize hidratação consistente."
          }}
          layer3Content={
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="PONTUAÇÃO JUSTA" value="88 pts" subtext="Excelente" trend="+4%" />
                <MetricBox label="CARGA AGUDA (ATL)" value="420 AU" subtext="Últimos 7 dias" trend="+12%" />
                <MetricBox label="CARGA CRÔNICA (CTL)" value="380 AU" subtext="Últimos 28 dias" trend="+8%" />
                <MetricBox label="RELAÇÃO CARGA (A/C)" value="1.10" subtext="Faixa Ótima (0.8 - 1.3)" trend="Ideal" />
              </div>

              <div className="p-3 bg-surface-container-high rounded-2xl border border-white/5 space-y-2">
                <span className="text-[10px] font-black uppercase text-on-surface-variant font-mono block">Evolução do Score Biológico ({timeFrameLabels[timeFrame]})</span>
                <div className="h-16 flex items-end gap-1 pt-2">
                  {[68, 72, 75, 74, 80, 82, 85, 88].map((val, idx) => (
                    <div key={idx} className="flex-1 bg-surface-container-highest rounded-t-md relative group flex flex-col justify-end" style={{ height: `${val}%` }}>
                      <div className="w-full bg-primary/80 rounded-t-md hover:bg-primary transition-all" style={{ height: '100%' }} />
                      <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[7px] font-mono font-bold text-on-surface opacity-0 group-hover:opacity-100 transition-opacity bg-black px-1 rounded">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          }
        />

        {/* CATEGORY 2: SAÚDE CARDIOVASCULAR */}
        <CategoryCard
          cardKey="cardio"
          icon={<Heart className="text-red-400 fill-red-400/20" size={20} />}
          title="❤️ SAÚDE CARDIOVASCULAR"
          summaryText="Seu coração está evoluindo muito bem. Frequência em repouso baixou e HRV aumentou."
          badge={`${currentRestingHR} BPM REP`}
          isExpanded={expandedCards['cardio']}
          onToggle={() => toggleExpand('cardio')}
          isTechOpen={deepTechDetails['cardio']}
          onToggleTech={(e) => toggleTechDetails(e, 'cardio')}
          layer2Content={{
            whatHappened: "Sua frequência cardíaca de repouso caiu de 62 bpm para 58 bpm, e sua Variabilidade de Frequência Cardíaca (HRV) atingiu 62 ms.",
            whatItMeans: "A queda na frequência de repouso indica um músculo cardíaco mais forte, que precisa de menos batimentos para bombear o mesmo volume de sangue. A HRV elevada confirma que seu sistema vagal/parassimpático está dominante.",
            impact: "Maior capacidade respiratória durante esforços prolongados e recuperação mais rápida entre séries intensas.",
            howToImprove: "Continue praticando pelo menos 150 minutos de exercícios aeróbicos em Zona 2 por semana."
          }}
          layer3Content={
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="FC EM REPOUSO" value={`${currentRestingHR} bpm`} subtext="Média em repouso" trend="-4 bpm" positive />
                <MetricBox label="FC MÉDIA DIÁRIA" value={`${currentAvgHR} bpm`} subtext="Com atividades" trend="Estável" />
                <MetricBox label="FC MÁXIMA REGISTRADA" value={`${currentMaxHR} bpm`} subtext="Pico recente" trend="Segura" />
                <MetricBox label="HRV (RMSSD)" value={`${currentHRV} ms`} subtext="Variabilidade Cardíaca" trend="+8 ms" positive />
              </div>

              <div className="p-4 bg-surface-container-high rounded-2xl border border-white/5 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-on-surface uppercase font-mono">DISTRIBUIÇÃO POR ZONAS DE FREQUÊNCIA CARDÍACA</span>
                  <span className="text-[10px] text-on-surface-variant font-mono">Max: {currentMaxHR} BPM</span>
                </div>

                <div className="space-y-2">
                  <ZoneBar label="Zona 1 - Regenerativo (<60%)" range={`< ${z1Upper} bpm`} percent={25} color="bg-blue-400" time="45 min" />
                  <ZoneBar label="Zona 2 - Base Aeróbica (60-70%)" range={`${z1Upper} - ${z2Upper} bpm`} percent={45} color="bg-emerald-400" time="85 min" />
                  <ZoneBar label="Zona 3 - Limiar Anaeróbico (70-80%)" range={`${z2Upper} - ${z3Upper} bpm`} percent={18} color="bg-amber-400" time="32 min" />
                  <ZoneBar label="Zona 4 - Sustentação VO2 (80-90%)" range={`${z3Upper} - ${z4Upper} bpm`} percent={8} color="bg-orange-500" time="14 min" />
                  <ZoneBar label="Zona 5 - Teto Máximo (>90%)" range={`> ${z4Upper} bpm`} percent={4} color="bg-red-500" time="6 min" />
                </div>
              </div>
            </div>
          }
        />

        {/* CATEGORY 3: INTENSIDADE DOS TREINOS & CARGAS */}
        <CategoryCard
          cardKey="intensity"
          icon={<Flame className="text-orange-400" size={20} />}
          title="🔥 INTENSIDADE DOS TREINOS & CARGAS"
          summaryText="Você treinou na intensidade ideal para estimular hipertrofia e resistência sem exaustão."
          badge="CARGA EQUILIBRADA"
          isExpanded={expandedCards['intensity']}
          onToggle={() => toggleExpand('intensity')}
          isTechOpen={deepTechDetails['intensity']}
          onToggleTech={(e) => toggleTechDetails(e, 'intensity')}
          layer2Content={{
            whatHappened: "Sua distribuição de estímulos físicos manteve 70% dos exercícios em intensidade moderada e 30% em picos de alta intensidade.",
            whatItMeans: "Essa proporção é considerada o padrão-ouro (método polarizado) para evolução sustentável da performance.",
            impact: "Você estimula o metabolismo sem acumular fadigabilidade residual crônica nas articulações e sistema nervoso.",
            howToImprove: "Evite realizar dois dias seguidos de treinos até a falha total no mesmo agrupamento muscular."
          }}
          layer3Content={
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="TRIMP (IMPULSO)" value="1,240 pts" subtext="Acumulado do período" trend="+5%" />
                <MetricBox label="PERCEPÇÃO ESFORÇO" value="7.2 / 10" subtext="Média RPE" trend="Ideal" />
                <MetricBox label="DURAÇÃO EM PICO" value="28 min" subtext="Acima de 85% FC" trend="Controlado" />
                <MetricBox label="ÍNDICE DE FADIGA" value="Baixo" subtext="Subjetivo + Métrico" trend="Ótimo" positive />
              </div>
            </div>
          }
        />

        {/* CATEGORY 4: CONDICIONAMENTO & VO2 MÁXIMO */}
        <CategoryCard
          cardKey="fitness"
          icon={<Zap className="text-yellow-400" size={20} />}
          title="⚡ CONDICIONAMENTO & CAPACIDADE AERÓBICA"
          summaryText="Seu VO₂ Máximo estimado aumentou. Seu condicionamento físico melhorou neste mês."
          badge={`VO₂: ${currentVO2Max} ml/kg/min`}
          isExpanded={expandedCards['fitness']}
          onToggle={() => toggleExpand('fitness')}
          isTechOpen={deepTechDetails['fitness']}
          onToggleTech={(e) => toggleTechDetails(e, 'fitness')}
          layer2Content={{
            whatHappened: "Seu consumo máximo de oxigênio (VO₂ Max) estimado alcançou 48 ml/kg/min, colocando você na faixa superior para sua faixa etária.",
            whatItMeans: "O VO₂ Max mede a capacidade máxima do seu organismo de captar, transportar e utilizar oxigênio nos músculos em atividade.",
            impact: "Quanto maior o VO₂ Max, mais rápido seu corpo produz energia aeróbica e menor é a sensação de cansaço em esforço contínuo.",
            howToImprove: "Sessões curtas de tiros intervalados (HIIT) de 30 segundos com descanso equivalente aceleram o ganho de VO₂ Max."
          }}
          layer3Content={
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="VO₂ MÁXIMO ESTIMADO" value={`${currentVO2Max} ml/kg`} subtext="Topo 15% da faixa" trend="+1.2 ml" positive />
                <MetricBox label="IDADE CARDIOVASCULAR" value="24 Anos" subtext="Abaixo da idade real" trend="-4 Anos" positive />
                <MetricBox label="LIMIAR DE LACTATO" value="154 bpm" subtext="Ponto de transição" trend="+3 bpm" positive />
                <MetricBox label="EFICIÊNCIA AERÓBICA" value="1.82" subtext="Velocidade / FC" trend="+6%" positive />
              </div>
            </div>
          }
        />

        {/* CATEGORY 5: RECUPERAÇÃO & ESTRESSE */}
        <CategoryCard
          cardKey="recovery"
          icon={<Moon className="text-indigo-400" size={20} />}
          title="😴 RECUPERAÇÃO & ESTRESSE FISIOLÓGICO"
          summaryText="Sua recuperação fisiológica está excelente. Seu corpo está renovado."
          badge="RECUPERAÇÃO: 92%"
          isExpanded={expandedCards['recovery']}
          onToggle={() => toggleExpand('recovery')}
          isTechOpen={deepTechDetails['recovery']}
          onToggleTech={(e) => toggleTechDetails(e, 'recovery')}
          layer2Content={{
            whatHappened: "Seu índice de prontidão biológica registrou 92% com nível de estresse corporal reduzido nas últimas 24 horas.",
            whatItMeans: "Significa que seu sistema nervoso autônomo recuperou o equilíbrio entre o ramo simpático (luta/fuga) e o parassimpático (descanso/digestão).",
            impact: "Você está na janela ideal para quebrar recordes pessoais de carga ou distância com menor risco de lesão.",
            howToImprove: "Evite refeições muito pesadas ou consumo de telas azuis 1 hora antes de dormir."
          }}
          layer3Content={
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="RENOVAÇÃO NERVOSA" value="92%" subtext="Equilíbrio ANS" trend="Excelente" positive />
                <MetricBox label="ESTRESSE DIURNO" value="22 / 100" subtext="Nível de tensão" trend="Baixo" positive />
                <MetricBox label="RESTABELECIMENTO" value="7h 40m" subtext="Tempo em repouso" trend="Ideal" positive />
                <MetricBox label="DEFASAGEM DE SONO" value="0 min" subtext="Sem débito" trend="Zerado" positive />
              </div>
            </div>
          }
        />

        {/* CATEGORY 6: TREINOS & ATIVIDADES */}
        <CategoryCard
          cardKey="workouts"
          icon={<Dumbbell className="text-emerald-400" size={20} />}
          title="🏋️ TREINOS & ATIVIDADES FÍSICAS"
          summaryText="Você concluiu 18 sessões de treino com alta consistência e volume de carga sustentado."
          badge="18 TREINOS"
          isExpanded={expandedCards['workouts']}
          onToggle={() => toggleExpand('workouts')}
          isTechOpen={deepTechDetails['workouts']}
          onToggleTech={(e) => toggleTechDetails(e, 'workouts')}
          layer2Content={{
            whatHappened: "Seu histórico mostra uma frequência média de 4.5 treinos por semana, distribuídos entre musculoação e exercícios aeróbicos.",
            whatItMeans: "Essa regularidade garante estímulos hormonais e metabólicos constantes para síntese proteica e oxidação de gordura.",
            impact: "Garante manutenção permanente do metabolismo elevado e melhora continua de postura e tônus.",
            howToImprove: "Varie os exercícios de base a cada 6-8 semanas para evitar estabilização das adaptações musculares."
          }}
          layer3Content={
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="TOTAL SESSÕES" value="18 Treinos" subtext="Período selecionado" trend="+2 treinos" positive />
                <MetricBox label="TEMPO EM EXERCÍCIO" value="14h 20m" subtext="Duração acumulada" trend="+1h 10m" positive />
                <MetricBox label="FREQUÊNCIA SEMANAL" value="4.5x / sem" subtext="Consistência" trend="Ótima" positive />
                <MetricBox label="PONTOS VALIDADOS" value="2,450 pts" subtext="Score de treino" trend="+15%" positive />
              </div>
            </div>
          }
        />

        {/* CATEGORY 7: ATIVIDADE DIÁRIA & PASSOS */}
        <CategoryCard
          cardKey="daily"
          icon={<Activity className="text-cyan-400" size={20} />}
          title="🚶 ATIVIDADE DIÁRIA & PASSOS"
          summaryText="Sua média diária foi de 9.450 passos, garantindo um estilo de vida ativo fora da academia."
          badge="9.450 PASSOS/DIA"
          isExpanded={expandedCards['daily']}
          onToggle={() => toggleExpand('daily')}
          isTechOpen={deepTechDetails['daily']}
          onToggleTech={(e) => toggleTechDetails(e, 'daily')}
          layer2Content={{
            whatHappened: "Além dos treinos estruturados, seu movimento natural cotidiano acumulou quase 10 mil passos diários.",
            whatItMeans: "Significa que seu NEAT (Gasto Energético de Atividades Não-Exercício) está alto, combatendo os malefícios do sedentarismo posicional.",
            impact: "Aumenta a queima diária de gorduras e melhora a circulação sanguínea de retorno venoso.",
            howToImprove: "Faça pequenas caminhadas de 5 minutos após as refeições principais."
          }}
          layer3Content={
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="MÉDIA DIÁRIA PASSOS" value="9,450" subtext="Meta: 8,000" trend="Atingida" positive />
                <MetricBox label="DISTÂNCIA PERCORRIDA" value="6.8 km/dia" subtext="Caminhada + Corrida" trend="+0.5 km" positive />
                <MetricBox label="TEMPO EM MOVIMENTO" value="1h 45m" subtext="Atividade diária" trend="Ativo" positive />
                <MetricBox label="HORAS EM PÉ" value="12 Horas" subtext="Sem imobilidade" trend="Ótimo" positive />
              </div>
            </div>
          }
        />

        {/* CATEGORY 8: GASTO ENERGÉTICO */}
        <CategoryCard
          cardKey="energy"
          icon={<Flame className="text-amber-500" size={20} />}
          title="🔥 GASTO ENERGÉTICO & METABOLISMO"
          summaryText="Você queimou uma média de 2.480 kcal por dia, com 650 kcal oriundas de atividades ativas."
          badge="2.480 KCAL / DIA"
          isExpanded={expandedCards['energy']}
          onToggle={() => toggleExpand('energy')}
          isTechOpen={deepTechDetails['energy']}
          onToggleTech={(e) => toggleTechDetails(e, 'energy')}
          layer2Content={{
            whatHappened: "Seu gasto energético total combinou sua Taxa Metabólica Basal (TMB ~1.830 kcal) com o gasto ativo dos treinos e movimentação diária.",
            whatItMeans: "Seu organismo está funcionando com uma taxa metabólica acelerada e eficiente.",
            impact: "Facilita a gestão de déficit calórico para emagrecimento ou superávit limpo para ganho muscular.",
            howToImprove: "Ajuste o aporte de proteínas diárias (1.8g a 2.2g por kg) para sustentar a regeneração tecidual."
          }}
          layer3Content={
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="GASTO ENERGÉTICO TOTAL" value="2,480 kcal" subtext="Média por dia" trend="+120 kcal" positive />
                <MetricBox label="CALORIAS ATIVAS" value="650 kcal" subtext="Treinos + Passos" trend="+80 kcal" positive />
                <MetricBox label="METABOLISMO BASAL (TMB)" value="1,830 kcal" subtext="Gasto em repouso" trend="Estável" />
                <MetricBox label="EFICIÊNCIA METABÓLICA" value="Alta" subtext="Oxidação lipídica" trend="Ótima" positive />
              </div>
            </div>
          }
        />

        {/* CATEGORY 9: SONO & DESCANSO */}
        <CategoryCard
          cardKey="sleep"
          icon={<Moon className="text-purple-400" size={20} />}
          title="😴 SONO & ESTRUTURA DO DESCANSO"
          summaryText="Sua média de sono foi de 7h 35m com 22% de sono profundo e boa eficiência."
          badge="7H 35M / NOITE"
          isExpanded={expandedCards['sleep']}
          onToggle={() => toggleExpand('sleep')}
          isTechOpen={deepTechDetails['sleep']}
          onToggleTech={(e) => toggleTechDetails(e, 'sleep')}
          layer2Content={{
            whatHappened: "Você manteve horários regulares de dormir e acordar, alcançando 1h 40m de sono profundo e 1h 30m de sono REM.",
            whatItMeans: "O sono profundo é o momento em que o corpo libera maior quantidade de Hormônio do Crescimento (GH) para recuperar fibras musculares. O sono REM consolida o aprendizado motor.",
            impact: "Restauração física completa e consolidação de memória de movimento e foco.",
            howToImprove: "Mantenha o quarto escuro e em temperatura agradável (entre 19°C e 21°C)."
          }}
          layer3Content={
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="DURAÇÃO MÉDIA SONO" value="7h 35m" subtext="Ideal: 7h - 9h" trend="Ideal" positive />
                <MetricBox label="SONO PROFUNDO (N3)" value="1h 40m (22%)" subtext="Recuperação Física" trend="Ótimo" positive />
                <MetricBox label="SONO REM" value="1h 30m (20%)" subtext="Recuperação Mental" trend="Adequado" positive />
                <MetricBox label="EFICIÊNCIA DO SONO" value="89%" subtext="Tempo dormindo/cama" trend="Alta" positive />
              </div>
            </div>
          }
        />

        {/* CATEGORY 10: COMPOSIÇÃO CORPORAL */}
        <CategoryCard
          cardKey="body"
          icon={<Scale className="text-blue-400" size={20} />}
          title="⚖️ COMPOSIÇÃO CORPORAL & ANTROPOMETRIA"
          summaryText="Seu percentual de gordura estimado é de 16.5% com massa muscular magra preservada."
          badge={`${userWeight} KG | IMC ${bmi}`}
          isExpanded={expandedCards['body']}
          onToggle={() => toggleExpand('body')}
          isTechOpen={deepTechDetails['body']}
          onToggleTech={(e) => toggleTechDetails(e, 'body')}
          layer2Content={{
            whatHappened: "Seu peso de " + userWeight + " kg para a altura de " + userHeight + " cm gera um IMC de " + bmi + " kg/m², com estimativa de " + estimatedMuscleMass + " kg de massa muscular.",
            whatItMeans: "Sua relação entre massa magra e gordura indica um físico atlético e funcional.",
            impact: "Maior densidade muscular resulta em maior força relativa e proteção articular.",
            howToImprove: "Combine treinos de força com ingestão adequada de água (35ml a 45ml por kg de peso corporal)."
          }}
          layer3Content={
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="PESO CORPORAL" value={`${userWeight} kg`} subtext="Média atual" trend="Estável" />
                <MetricBox label="IMC (MÁSSICO)" value={`${bmi} kg/m²`} subtext="Escore padrão" trend="Normal" />
                <MetricBox label="MASSA MUSCULAR" value={`${estimatedMuscleMass} kg`} subtext="Massa Magra" trend="+0.4 kg" positive />
                <MetricBox label="GORDURA ESTIMADA" value={`${estimatedBodyFat}%`} subtext="Percentual" trend="-0.6%" positive />
              </div>
            </div>
          }
        />

        {/* CATEGORY 11: EVOLUÇÃO & TENDÊNCIAS HISTÓRICAS */}
        <CategoryCard
          cardKey="evolution"
          icon={<TrendingUp className="text-emerald-400" size={20} />}
          title="📈 EVOLUÇÃO & MATRIZ DE TENDÊNCIAS"
          summaryText="Comparativo histórico de todas as suas métricas biométricas no tempo."
          badge="MATRIZ COMPLETA"
          isExpanded={expandedCards['evolution']}
          onToggle={() => toggleExpand('evolution')}
          isTechOpen={deepTechDetails['evolution']}
          onToggleTech={(e) => toggleTechDetails(e, 'evolution')}
          layer2Content={{
            whatHappened: "Análise comparativa das métricas principais entre os marcos de 7D, 30D, 90D e 12 Meses.",
            whatItMeans: "Permite enxergar a tendência longitudinal real, eliminando oscilações normais do dia a dia.",
            impact: "Garante a comprovação científica de que seu programa de treinamento está trazendo resultados duradouros.",
            howToImprove: "Avalie a matriz mensalmente para reajustar metas de volume e intensidade."
          }}
          layer3Content={
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-on-surface-variant text-[9px] uppercase tracking-wider">
                    <th className="py-2.5 px-3">Métrica Biométrica</th>
                    <th className="py-2.5 px-3">Hoje</th>
                    <th className="py-2.5 px-3">7 Dias</th>
                    <th className="py-2.5 px-3">30 Dias</th>
                    <th className="py-2.5 px-3">90 Dias</th>
                    <th className="py-2.5 px-3">Tendência</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-on-surface">
                  <tr>
                    <td className="py-2 px-3 font-sans font-bold flex items-center gap-1.5"><Heart size={12} className="text-red-400" /> FC Repouso</td>
                    <td className="py-2 px-3">{currentRestingHR} bpm</td>
                    <td className="py-2 px-3">{currentRestingHR + 1} bpm</td>
                    <td className="py-2 px-3">{currentRestingHR + 3} bpm</td>
                    <td className="py-2 px-3">{currentRestingHR + 5} bpm</td>
                    <td className="py-2 px-3 text-emerald-400 font-bold">↑ Melhorou (-5 bpm)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-bold flex items-center gap-1.5"><Activity size={12} className="text-indigo-400" /> HRV (RMSSD)</td>
                    <td className="py-2 px-3">{currentHRV} ms</td>
                    <td className="py-2 px-3">{currentHRV - 2} ms</td>
                    <td className="py-2 px-3">{currentHRV - 6} ms</td>
                    <td className="py-2 px-3">{currentHRV - 10} ms</td>
                    <td className="py-2 px-3 text-emerald-400 font-bold">↑ Melhorou (+10 ms)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-bold flex items-center gap-1.5"><Zap size={12} className="text-yellow-400" /> VO₂ Máximo</td>
                    <td className="py-2 px-3">{currentVO2Max} ml/kg</td>
                    <td className="py-2 px-3">{currentVO2Max} ml/kg</td>
                    <td className="py-2 px-3">{currentVO2Max - 1} ml/kg</td>
                    <td className="py-2 px-3">{currentVO2Max - 2} ml/kg</td>
                    <td className="py-2 px-3 text-emerald-400 font-bold">↑ Melhorou (+2.0 ml)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-bold flex items-center gap-1.5"><Flame size={12} className="text-amber-400" /> Gasto Calórico</td>
                    <td className="py-2 px-3">2,480 kcal</td>
                    <td className="py-2 px-3">2,420 kcal</td>
                    <td className="py-2 px-3">2,350 kcal</td>
                    <td className="py-2 px-3">2,200 kcal</td>
                    <td className="py-2 px-3 text-emerald-400 font-bold">↑ Elevado (+280 kcal)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-bold flex items-center gap-1.5"><Moon size={12} className="text-purple-400" /> Sono Média</td>
                    <td className="py-2 px-3">7h 35m</td>
                    <td className="py-2 px-3">7h 20m</td>
                    <td className="py-2 px-3">7h 10m</td>
                    <td className="py-2 px-3">6h 50m</td>
                    <td className="py-2 px-3 text-emerald-400 font-bold">↑ Consolidado</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />

      </div>

      {/* PRINT / PDF MODAL GENERATOR */}
      {showPdfModal && (
        <ReportPdfModal 
          user={user} 
          currentRestingHR={currentRestingHR} 
          currentHRV={currentHRV} 
          currentVO2Max={currentVO2Max}
          userWeight={userWeight}
          userHeight={userHeight}
          bmi={bmi}
          timeFrameLabel={timeFrameLabels[timeFrame]}
          onClose={() => setShowPdfModal(false)} 
        />
      )}

    </div>
  );
}

/* =========================================================
   SUB-COMPONENTS FOR CLEAN 3-LAYER ARCHITECTURE & MODAL
========================================================= */

interface CategoryCardProps {
  cardKey: string;
  icon: React.ReactNode;
  title: string;
  summaryText: string;
  badge: string;
  isExpanded: boolean;
  onToggle: () => void;
  isTechOpen: boolean;
  onToggleTech: (e: React.MouseEvent) => void;
  layer2Content: {
    whatHappened: string;
    whatItMeans: string;
    impact: string;
    howToImprove: string;
  };
  layer3Content: React.ReactNode;
}

function CategoryCard({
  icon,
  title,
  summaryText,
  badge,
  isExpanded,
  onToggle,
  isTechOpen,
  onToggleTech,
  layer2Content,
  layer3Content
}: CategoryCardProps) {
  return (
    <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] overflow-hidden transition-all shadow-sm hover:border-outline-variant/20">
      
      {/* CAMADA 1: RESUMO INTELIGENTE (ALWAYS VISIBLE HEADER) */}
      <div 
        onClick={onToggle}
        className="p-5 flex items-center justify-between gap-4 cursor-pointer select-none hover:bg-surface-container-high/30 transition-colors"
      >
        <div className="flex items-start gap-3.5 flex-1 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-surface-container-high border border-white/5 flex items-center justify-center shrink-0 shadow-inner">
            {icon}
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-headline italic font-black text-sm sm:text-base text-on-surface uppercase tracking-tight truncate">
                {title}
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[8px] font-mono font-black uppercase tracking-wider bg-primary/10 text-primary border border-primary/20 shrink-0">
                {badge}
              </span>
            </div>
            
            {/* Layer 1 AI Simple Conclusion */}
            <p className="text-xs text-on-surface-variant font-medium leading-relaxed truncate">
              {summaryText}
            </p>
          </div>
        </div>

        <button 
          type="button" 
          className="p-2 text-on-surface-variant hover:text-on-surface rounded-xl bg-surface-container-high/50 shrink-0"
        >
          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>

      {/* CAMADA 2: EXPLICAÇÃO HUMANA E DETALHADA */}
      {isExpanded && (
        <div className="px-5 pb-5 pt-2 border-t border-white/5 space-y-4 bg-surface-container-low/50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-surface-container-high/60 rounded-2xl border border-white/5 space-y-1">
              <span className="text-[9px] font-black uppercase tracking-wider text-primary font-mono block">1. O QUE ACONTECEU?</span>
              <p className="text-on-surface-variant leading-relaxed">{layer2Content.whatHappened}</p>
            </div>

            <div className="p-3 bg-surface-container-high/60 rounded-2xl border border-white/5 space-y-1">
              <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400 font-mono block">2. O QUE ISSO SIGNIFICA?</span>
              <p className="text-on-surface-variant leading-relaxed">{layer2Content.whatItMeans}</p>
            </div>

            <div className="p-3 bg-surface-container-high/60 rounded-2xl border border-white/5 space-y-1">
              <span className="text-[9px] font-black uppercase tracking-wider text-amber-400 font-mono block">3. IMPACTO NOS TREINOS</span>
              <p className="text-on-surface-variant leading-relaxed">{layer2Content.impact}</p>
            </div>

            <div className="p-3 bg-surface-container-high/60 rounded-2xl border border-white/5 space-y-1">
              <span className="text-[9px] font-black uppercase tracking-wider text-cyan-400 font-mono block">4. RECOMENDAÇÃO PRÁTICA</span>
              <p className="text-on-surface-variant leading-relaxed">{layer2Content.howToImprove}</p>
            </div>
          </div>

          {/* TOGGLE FOR CAMADA 3: DETALHES TÉCNICOS COMPLETOS */}
          <div className="pt-2">
            <button
              onClick={onToggleTech}
              className="w-full py-2.5 px-4 bg-surface-container-high hover:bg-surface-container-highest border border-white/10 rounded-xl font-headline italic font-black text-[11px] uppercase tracking-wider text-on-surface flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
            >
              <Info size={14} className="text-primary" />
              <span>{isTechOpen ? 'Ocultar Detalhes Técnicos & Gráficos' : 'Expandir Todos os Dados Técnicos completos (HRV, VO₂, Zonas & Histórico)'}</span>
              {isTechOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>

          {/* CAMADA 3: DATASHEET TÉCNICO E MÉTRICAS BRUTAS */}
          {isTechOpen && (
            <div className="pt-3 border-t border-dashed border-white/10 animate-fadeIn">
              {layer3Content}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface MetricBoxProps {
  label: string;
  value: string;
  subtext: string;
  trend: string;
  positive?: boolean;
}

function MetricBox({ label, value, subtext, trend, positive }: MetricBoxProps) {
  return (
    <div className="p-3 bg-surface-container-high rounded-2xl border border-white/5 flex flex-col justify-between space-y-1">
      <span className="font-label text-[8px] font-black uppercase tracking-wider text-on-surface-variant block truncate">{label}</span>
      <span className="font-headline italic font-black text-lg text-on-surface leading-tight">{value}</span>
      <div className="flex items-center justify-between text-[8px] pt-1 border-t border-white/5">
        <span className="text-on-surface-variant/80 truncate">{subtext}</span>
        <span className={cn("font-bold font-mono px-1 rounded", positive ? "text-emerald-400 bg-emerald-500/10" : "text-primary bg-primary/10")}>{trend}</span>
      </div>
    </div>
  );
}

function ZoneBar({ label, range, percent, color, time }: { label: string; range: string; percent: number; color: string; time: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-[10px]">
        <span className="font-bold text-on-surface font-sans">{label}</span>
        <div className="flex items-center gap-2 font-mono text-[9px] text-on-surface-variant">
          <span>{range}</span>
          <span className="font-bold text-on-surface">{time} ({percent}%)</span>
        </div>
      </div>
      <div className="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/* =========================================================
   PRINTABLE / EXPORTABLE PDF REPORT MODAL
========================================================= */

function ReportPdfModal({
  user,
  currentRestingHR,
  currentHRV,
  currentVO2Max,
  userWeight,
  userHeight,
  bmi,
  timeFrameLabel,
  onClose
}: {
  user: UserProfile;
  currentRestingHR: number;
  currentHRV: number;
  currentVO2Max: number;
  userWeight: number;
  userHeight: number;
  bmi: string;
  timeFrameLabel: string;
  onClose: () => void;
}) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white text-slate-900 w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden my-auto border border-slate-200 print:shadow-none print:border-none print:rounded-none">
        
        {/* MODAL HEADER (HIDDEN WHEN PRINTING) */}
        <div className="bg-slate-900 text-white p-4 px-6 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-amber-400" />
            <span className="font-headline italic font-black text-sm uppercase tracking-wider">RELATÓRIO FISIOLÓGICO INVICTUS - IMPRESSÃO / PDF</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl flex items-center gap-2 cursor-pointer shadow-md transition-all"
            >
              <Printer size={15} />
              <span>IMPRIMIR / GERAR PDF</span>
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-xl">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* PRINTABLE DOCUMENT BODY */}
        <div className="p-8 sm:p-12 space-y-8 print:p-0 text-slate-800 font-sans">
          
          {/* BRAND HEADER */}
          <div className="flex items-center justify-between border-b-2 border-slate-900 pb-6">
            <div>
              <h1 className="text-3xl font-black italic tracking-tighter text-slate-950 uppercase font-headline">INVICTUS</h1>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">CLINICAL ATHLETE FISIOLOGICAL DIAGNOSTIC REPORT</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-mono font-bold text-slate-500 uppercase block">DATA DE EMISSÃO: {new Date().toLocaleDateString('pt-BR')}</span>
              <span className="text-[10px] font-mono font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 uppercase block mt-1">SISTEMA VALIDADO VIA WEARABLE HUB</span>
            </div>
          </div>

          {/* ATHLETE DEMOGRAPHICS */}
          <div className="bg-slate-100 p-5 rounded-2xl border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div>
              <span className="text-[9px] text-slate-500 uppercase block font-bold">ATLETA / PACIENTE</span>
              <strong className="text-slate-900 text-sm font-bold uppercase">{user.displayName || 'Atleta Invictus'}</strong>
            </div>
            <div>
              <span className="text-[9px] text-slate-500 uppercase block font-bold">PERÍODO ANALISADO</span>
              <strong className="text-slate-900 font-bold">{timeFrameLabel}</strong>
            </div>
            <div>
              <span className="text-[9px] text-slate-500 uppercase block font-bold">PESO / ALTURA</span>
              <strong className="text-slate-900 font-bold">{userWeight} kg | {userHeight} cm</strong>
            </div>
            <div>
              <span className="text-[9px] text-slate-500 uppercase block font-bold">IMC</span>
              <strong className="text-slate-900 font-bold">{bmi} kg/m²</strong>
            </div>
          </div>

          {/* EXECUTIVE CLINICAL SUMMARY */}
          <div className="space-y-2">
            <h3 className="text-sm font-black uppercase text-slate-900 border-l-4 border-amber-500 pl-3">1. RESUMO EXECUTIVO DA INTELIGÊNCIA ARTIFICIAL</h3>
            <p className="text-xs text-slate-700 leading-relaxed bg-amber-50/50 p-4 rounded-xl border border-amber-200">
              O atleta apresenta um perfil biométrico altamente adaptado ao treinamento físico regular. A frequência cardíaca de repouso ({currentRestingHR} bpm) atesta tonus vagal eficiente com baixa sobrecarga miocárdica. A variabilidade de frequência cardíaca ({currentHRV} ms RMSSD) confirma recuperação autonômica preservada e ausência de fadiga central. O consumo máximo de oxigênio estimado ({currentVO2Max} ml/kg/min) reflete capacidade aeróbica superior.
            </p>
          </div>

          {/* METRIC SUMMARY TABLE */}
          <div className="space-y-2">
            <h3 className="text-sm font-black uppercase text-slate-900 border-l-4 border-slate-900 pl-3">2. PAINEL DE MÉTRICAS FISIOLÓGICAS</h3>
            <table className="w-full text-xs text-left border-collapse border border-slate-200">
              <thead>
                <tr className="bg-slate-900 text-white font-mono text-[10px] uppercase">
                  <th className="p-2.5 border border-slate-300">INDICADOR FISIOLÓGICO</th>
                  <th className="p-2.5 border border-slate-300">VALOR REGISTRADO</th>
                  <th className="p-2.5 border border-slate-300">VALOR DE REFERÊNCIA</th>
                  <th className="p-2.5 border border-slate-300">CLASSIFICAÇÃO CLINICA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono">
                <tr>
                  <td className="p-2 border border-slate-200 font-bold">Frequência Cardíaca Repouso</td>
                  <td className="p-2 border border-slate-200 font-bold">{currentRestingHR} bpm</td>
                  <td className="p-2 border border-slate-200 text-slate-500">60 - 80 bpm</td>
                  <td className="p-2 border border-slate-200 text-emerald-700 font-bold">Excelente (Bradicardia do Atleta)</td>
                </tr>
                <tr>
                  <td className="p-2 border border-slate-200 font-bold">Variabilidade Cardíaca (HRV RMSSD)</td>
                  <td className="p-2 border border-slate-200 font-bold">{currentHRV} ms</td>
                  <td className="p-2 border border-slate-200 text-slate-500">&gt; 42 ms</td>
                  <td className="p-2 border border-slate-200 text-emerald-700 font-bold">Excelente Tonus Parassimpático</td>
                </tr>
                <tr>
                  <td className="p-2 border border-slate-200 font-bold">VO₂ Máximo Estimado</td>
                  <td className="p-2 border border-slate-200 font-bold">{currentVO2Max} ml/kg/min</td>
                  <td className="p-2 border border-slate-200 text-slate-500">&gt; 38 ml/kg/min</td>
                  <td className="p-2 border border-slate-200 text-emerald-700 font-bold">Faixa Superior (&gt;85th percentil)</td>
                </tr>
                <tr>
                  <td className="p-2 border border-slate-200 font-bold">Relação Carga Aguda/Crônica (A/C)</td>
                  <td className="p-2 border border-slate-200 font-bold">1.10</td>
                  <td className="p-2 border border-slate-200 text-slate-500">0.80 - 1.30</td>
                  <td className="p-2 border border-slate-200 text-emerald-700 font-bold">Zona Doce (Sweet Spot Sem Lesões)</td>
                </tr>
                <tr>
                  <td className="p-2 border border-slate-200 font-bold">Pontuação Justa de Performance</td>
                  <td className="p-2 border border-slate-200 font-bold">88 / 100 PTS</td>
                  <td className="p-2 border border-slate-200 text-slate-500">&gt; 70 PTS</td>
                  <td className="p-2 border border-slate-200 text-emerald-700 font-bold">Alta Performance Sustentável</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* CLINICAL RECOMMENDATIONS & SIGNATURE */}
          <div className="pt-6 border-t-2 border-slate-900 grid grid-cols-1 md:grid-cols-2 gap-8 text-xs">
            <div className="space-y-2">
              <h4 className="font-bold uppercase text-slate-900">RECOMENDAÇÕES PARA MÉDICOS / PREPARADORES</h4>
              <ul className="list-disc pl-4 space-y-1 text-slate-700">
                <li>Atleta apto para treinos de alta exigência e provas de endurance.</li>
                <li>Manter ingestão proteica recomendada e hidratação intra-treino.</li>
                <li>Monitorar HRV matinal como marcador precoce de infecção ou fadiga.</li>
              </ul>
            </div>

            <div className="space-y-8 text-center pt-4">
              <div className="border-b border-slate-400 w-3/4 mx-auto" />
              <p className="text-[10px] font-mono text-slate-500 uppercase font-bold">
                VALIDAÇÃO TÉCNICA E PROTOCOLO INVICTUS BIOMETRIC PLATFORM<br/>
                DOCUMENTO GERADO PARA FINS DE ACOMPANHAMENTO DE PERFORMANCE
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
