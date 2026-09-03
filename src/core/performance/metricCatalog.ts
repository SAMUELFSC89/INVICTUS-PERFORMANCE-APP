export type TimeRange = 'today' | 'yesterday' | '7days' | '30days' | '90days' | '1year' | 'all';

export type ReliabilityLevel = 'alta' | 'media' | 'baixa';

export type DataSourceType = 
  | 'Health Connect' 
  | 'Apple Health' 
  | 'Strava' 
  | 'Wearables / Garmin / Whoop' 
  | 'Banco Invictus (Workouts)' 
  | 'Check-in de Presença (GPS/Gym)' 
  | 'Frequência Cardíaca (Sensor)' 
  | 'Acelerômetro' 
  | 'Registro Manual Validado'
  | 'Servidor IGA Engine'
  | 'Servidor Invictus Core';

export interface PerformanceMetricDef {
  id: string;
  category: 
    | 'performance_volume' 
    | 'cardiovascular' 
    | 'energy_load' 
    | 'recovery' 
    | 'consistency' 
    | 'records_evolution' 
    | 'ranking_iga' 
    | 'projections';
  name: string;
  objective: string;
  simpleDescription: string;
  technicalDescription: string;
  formula: string;
  unit: string;
  dataSources: DataSourceType[];
  howObtained: string;
  deviceTypes: string[];
  updateFrequency: 'Tempo Real' | 'Diária' | 'Semanal' | 'Mensal';
  minConditions: string;
  storageAndHistory: string;
  displayMethod: 'Grafico Linha' | 'Grafico Barras' | 'Gauge / Radial' | 'Card Metric + Badge' | 'Progress Bar';
  aiUsage: string;
  insufficientDataBehavior: string;
}

export const METRIC_CATALOG: PerformanceMetricDef[] = [
  // 1. PERFORMANCE & VOLUME
  {
    id: 'total_volume_time',
    category: 'performance_volume',
    name: 'Tempo Total de Treino (Volume)',
    objective: 'Mapear a quantidade total de minutos dedicados ao exercício físico no período.',
    simpleDescription: 'Soma total de minutos em que seu corpo esteve sob esforço físico ativamente registrado.',
    technicalDescription: 'Somatório acumulado das durações t_i de todas as sessões de treino validadas no intervalo [t_inicio, t_fim].',
    formula: 'T_{total} = \\sum_{i=1}^{N} duration_i \\text{ (minutos)}',
    unit: 'minutos',
    dataSources: ['Banco Invictus (Workouts)', 'Health Connect', 'Apple Health', 'Strava', 'Wearables / Garmin / Whoop'],
    howObtained: 'Capturado via timer do app, sincronização Bluetooth/API de wearables ou log verificado de sessão.',
    deviceTypes: ['Smartwatch', 'Cinta Cardíaca', 'Smartphone (GPS)', 'Validador Gym'],
    updateFrequency: 'Tempo Real',
    minConditions: 'Pelo menos 1 treino validado no período selecionado.',
    storageAndHistory: 'Armazenado permanentemente por sessão no Firestore (workouts/biometric_metrics). Histórico ilimitado.',
    displayMethod: 'Card Metric + Badge',
    aiUsage: 'A IA utiliza esse valor para calcular densidade semanal e verificar progressão de carga de treino.',
    insufficientDataBehavior: 'Exibe "Aguardando 1º Treino" sem números fictícios e indica o botão para registrar sessão.'
  },
  {
    id: 'workout_count',
    category: 'performance_volume',
    name: 'Frequência Total de Sessões',
    objective: 'Contabilizar o número absoluto de sessões ativas concluídas com sucesso.',
    simpleDescription: 'Quantidade de treinos ou atividades esportivas finalizadas e auditadas.',
    technicalDescription: 'Contagem cardinal N do conjunto de sessões com status == "validated" ou "approved" no intervalo de tempo.',
    formula: 'N_{treinos} = \\sum_{i=1}^{k} [status_i \\in \\{\\text{validado, aprovado}\\}]',
    unit: 'treinos',
    dataSources: ['Banco Invictus (Workouts)', 'Check-in de Presença (GPS/Gym)'],
    howObtained: 'Calculado pelo banco de dados Invictus a partir de validações de imagem, IA ou check-in na academia.',
    deviceTypes: ['App Mobile Invictus', 'Gym Totem'],
    updateFrequency: 'Tempo Real',
    minConditions: 'Pelo menos 1 registro no banco.',
    storageAndHistory: 'Sessões salvas na coleção `workouts` com timestamp e audit trail. Mantido para sempre.',
    displayMethod: 'Card Metric + Badge',
    aiUsage: 'Permite à IA avaliar a regularidade do atleta e prevenir perda de pontuação de consistência.',
    insufficientDataBehavior: 'Mostra 0 treinos e explica os requisitos para homologar uma sessão.'
  },
  {
    id: 'average_session_duration',
    category: 'performance_volume',
    name: 'Duração Média por Treino',
    objective: 'Avaliar a cadência e sustentabilidade do tempo médio de cada sessão.',
    simpleDescription: 'A média de minutos que você costuma treinar em cada ida à academia ou corrida.',
    technicalDescription: 'Razão entre o tempo total acumulado e a quantidade total de treinos válidos no período.',
    formula: '\\bar{T} = \\frac{T_{total}}{N_{treinos}}',
    unit: 'min/treino',
    dataSources: ['Banco Invictus (Workouts)', 'Wearables / Garmin / Whoop'],
    howObtained: 'Dividindo a soma de minutagem de sessões válidas pelo número de treinos.',
    deviceTypes: ['Smartwatch', 'App Mobile'],
    updateFrequency: 'Diária',
    minConditions: 'No mínimo 2 treinos registrados para média estatística.',
    storageAndHistory: 'Calculado dinamicamente sobre a série histórica do usuário.',
    displayMethod: 'Grafico Barras',
    aiUsage: 'Informa à IA se o atleta está fazendo treinos muito curtos (<20min) ou excessivamente longos (>90min).',
    insufficientDataBehavior: 'Indica "Requer ao menos 2 treinos para calcular a média".'
  },

  // 2. CARDIOVASCULAR
  {
    id: 'avg_heart_rate',
    category: 'cardiovascular',
    name: 'Frequência Cardíaca Média (BPM)',
    objective: 'Mapear a exigência cardiovascular média exercida pelo sistema circulatório.',
    simpleDescription: 'Média de batimentos por minuto registada durante o tempo de exercício.',
    technicalDescription: 'Média ponderada pelo tempo das amostras ópticas (PPG) ou elétricas (ECG) obtidas durante o treino.',
    formula: 'HR_{avg} = \\frac{1}{T} \\int_{0}^{T} HR(t) dt',
    unit: 'bpm',
    dataSources: ['Frequência Cardíaca (Sensor)', 'Health Connect', 'Apple Health', 'Strava', 'Wearables / Garmin / Whoop'],
    howObtained: 'Amostragem contínua via fotopletermografia (PPG) de smartwatch/cinta de peito conectada.',
    deviceTypes: ['Apple Watch', 'Garmin', 'Whoop', 'Polar', 'Galax Watch', 'Xiaomi Band'],
    updateFrequency: 'Tempo Real',
    minConditions: 'Sensor de pulso/cinta cardíaca pareado e ativo durante a sessão.',
    storageAndHistory: 'Registrado em `biometric_metrics` com média e pico por sessão.',
    displayMethod: 'Grafico Linha',
    aiUsage: 'Utilizado pela IA para determinar eficiência miocárdica e zonas de estresse do organismo.',
    insufficientDataBehavior: 'Exibe "Sensor Cardíaco Não Detectado" e orienta a conectar via Bluetooth/Health Connect.'
  },
  {
    id: 'max_heart_rate_session',
    category: 'cardiovascular',
    name: 'Frequência Cardíaca Máxima Atingida',
    objective: 'Identificar o pico máximo de solicitação cardiovascular no período.',
    simpleDescription: 'O maior valor de batimentos por minuto atingido pelo seu coração no esforço.',
    technicalDescription: 'Valor supremo da função discreta HR(t) registrada nos sensores de pulso no período.',
    formula: 'HR_{max\_atingida} = \\max_{t} \\{ HR(t) \\}',
    unit: 'bpm',
    dataSources: ['Frequência Cardíaca (Sensor)', 'Apple Health', 'Health Connect', 'Wearables / Garmin / Whoop'],
    howObtained: 'Leitura contínua com detecção automática de picos pelo sensor do relógio ou cinta.',
    deviceTypes: ['Smartwatch com sensor óptico/ECG'],
    updateFrequency: 'Tempo Real',
    minConditions: 'Pelo menos 1 leitura válida de sensor biométrico.',
    storageAndHistory: 'Armazenado permanentemente no banco Invictus e atualizado se for novo recorde.',
    displayMethod: 'Card Metric + Badge',
    aiUsage: 'Alerta a IA sobre picos de intensidade perigosos ou se o atleta atingiu 100% da sua FC Max biológica.',
    insufficientDataBehavior: 'Mostra "Aguardando Monitor Cardíaco".'
  },
  {
    id: 'vo2max_estimate',
    category: 'cardiovascular',
    name: 'VO₂ Máx. Estimado',
    objective: 'Estimar a capacidade cardiorrespiratória máxima do atleta a partir de corridas/caminhadas reais com GPS e frequência cardíaca.',
    simpleDescription: 'Estimativa do quanto seu corpo consegue usar oxigênio no esforço máximo, calculada a partir das suas corridas/caminhadas reais.',
    technicalDescription: 'Combina a equação metabólica submáxima do ACSM (VO2 a partir do ritmo real da corrida, em piso plano) com extrapolação pela razão entre a FC Máxima do perfil e a FC média real da sessão. Usa a média das últimas sessões de corrida/caminhada ao ar livre elegíveis (ritmo entre 3 e 20 km/h) com FC média abaixo da FC Máxima cadastrada.',
    formula: 'VO_{2sub} = 3.5 + 0.2v \\;(corrida) \\text{ ou } 3.5 + 0.1v \\;(caminhada);\\quad VO_{2max} \\approx VO_{2sub} \\times \\frac{HR_{max}}{HR_{sessão}}',
    unit: 'ml/kg/min',
    dataSources: ['Banco Invictus (Workouts)', 'Frequência Cardíaca (Sensor)', 'Health Connect', 'Apple Health', 'Strava'],
    howObtained: 'Calculado a partir de sessões reais de corrida/caminhada ao ar livre com distância, duração e FC média válidas, mais a FC Máxima cadastrada no perfil.',
    deviceTypes: ['Smartwatch com GPS', 'Cinta Cardíaca', 'Smartphone (GPS)'],
    updateFrequency: 'Diária',
    minConditions: 'Ao menos 1 corrida/caminhada ao ar livre com GPS, FC média registrada e FC Máxima informada no perfil.',
    storageAndHistory: 'Calculado dinamicamente sobre as sessões válidas do período.',
    displayMethod: 'Card Metric + Badge',
    aiUsage: 'A IA usa a tendência do VO2 estimado para avaliar evolução cardiorrespiratória ao longo do tempo.',
    insufficientDataBehavior: 'Exibe "Requer corrida/caminhada com GPS + FC + FC Máxima cadastrada" sem estimar sem esses dados.'
  },
  {
    id: 'hr_zones_distribution',
    category: 'cardiovascular',
    name: 'Distribuição por Zonas Cardíacas (Z1 a Z5)',
    objective: 'Classificar o tempo exato investido em cada faixa fisiológica de esforço.',
    simpleDescription: 'Porcentagem de tempo em que seu coração esteve leve, moderado, intenso ou no limite.',
    technicalDescription: 'Segmentação do tempo de treino em 5 faixas calculadas a partir da FC máxima individual cadastrada: Z1 (50-60%), Z2 (60-70%), Z3 (70-80%), Z4 (80-90%), Z5 (90-100%).',
    formula: '%Z_k = \\frac{\\text{Tempo em } Z_k}{T_{FC\\,coberto}} \\times 100',
    unit: '% do tempo',
    dataSources: ['Frequência Cardíaca (Sensor)', 'Apple Health', 'Health Connect', 'Wearables / Garmin / Whoop'],
    howObtained: 'Histograma do sinal cardíaco sincronizado durante treinos, calculado nos intervalos entre leituras reais; lacunas longas não são preenchidas.',
    deviceTypes: ['Smartwatch', 'Cinta Cardíaca'],
    updateFrequency: 'Diária',
    minConditions: 'Ao menos 3 amostras reais com pelo menos 60 segundos de cobertura e FC máxima individual cadastrada.',
    storageAndHistory: 'Matriz de zonas salva por sessão. Histórico completo por período.',
    displayMethod: 'Gauge / Radial',
    aiUsage: 'Fundamento para a IA recomendar dias de Zone 2 Cardio ou alívio do estresse sistema nervoso.',
    insufficientDataBehavior: 'Exibe gráfico bloqueado com aviso "Sincronize seu relógio para mapear zonas cardíacas".'
  },

  // 3. ENERGY & LOAD
  {
    id: 'total_calories_burned',
    category: 'energy_load',
    name: 'Gasto Calórico Total Validado',
    objective: 'Mapear o dispêndio energético das sessões ativas registradas.',
    simpleDescription: 'Total de calorias queimadas durante seus treinos comprovados.',
    technicalDescription: 'Cálculo metabólico derivado da equação de Keytel (HR + Peso + Idade) ou equivalência MET x Tempo x Massa Corporal.',
    formula: 'kcal = T \\times MET \\times 3.5 \\times \\frac{\\text{Peso (kg)}}{200}',
    unit: 'kcal',
    dataSources: ['Banco Invictus (Workouts)', 'Health Connect', 'Apple Health', 'Wearables / Garmin / Whoop', 'Acelerômetro'],
    howObtained: 'Fornecido por algoritmos do smartwatch ou calculado pelo motor MET do Invictus com base no tipo de treino e peso.',
    deviceTypes: ['Smartwatch', 'App Invictus Engine'],
    updateFrequency: 'Tempo Real',
    minConditions: 'Massa corporal (peso) informada no perfil + duração do treino.',
    storageAndHistory: 'Gravado em cada workout no Firestore. Acumulado histórico ilimitado.',
    displayMethod: 'Card Metric + Badge',
    aiUsage: 'Usado na validação do Gate de Coerência Calorias do IGA para prevenir fraude.',
    insufficientDataBehavior: 'Pede para atualizar o peso no perfil antes de computar calorias exatas.'
  },
  {
    id: 'calorie_gate_ratio',
    category: 'energy_load',
    name: 'Razão de Coerência Calórica (Calorie Gate r)',
    objective: 'Garantir que as calorias informadas respeitam os limites fisiológicos humanos.',
    simpleDescription: 'Índice de segurança que verifica se seu gasto calórico bate com a realidade biológica.',
    technicalDescription: 'Razão r = Calorias_Informadas / Calorias_Esperadas_MET. Faixa válida sem penalidade: 0.70 <= r <= 1.40.',
    formula: 'r = \\frac{kcal_{informada}}{kcal_{esperada}}',
    unit: 'índice (r)',
    dataSources: ['Banco Invictus (Workouts)', 'Frequência Cardíaca (Sensor)'],
    howObtained: 'Auditado pelo algoritmo IGA durante a validação da sessão.',
    deviceTypes: ['Servidor Invictus IGA Core'],
    updateFrequency: 'Tempo Real',
    minConditions: 'Treino cadastrado com duração e calorias informadas.',
    storageAndHistory: 'Salvo na auditoria IGA do usuário (`igaAudit`). Histórico auditável permanentemente.',
    displayMethod: 'Progress Bar',
    aiUsage: 'A IA utiliza esse valor para indicar se um treino foi legítimo ou sofreu atenuação de pontuação por inconsistência.',
    insufficientDataBehavior: 'Exibe "Gate Inativo - Aguardando Sessão Auditorada".'
  },
  {
    id: 'acute_chronic_workload_ratio',
    category: 'energy_load',
    name: 'Carga Semanal Acumulada (Volume x Intensidade)',
    objective: 'Identificar picos abruptos de volume que aumentam o risco de lesões musculares.',
    simpleDescription: 'Pontuação de carga de esforço nas últimas semanas para evitar overtraining.',
    technicalDescription: 'Proporção entre Carga Aguda (últimos 7 dias) e Carga Crônica (média dos últimos 28 dias) em Unidades de Esforço (AU).',
    formula: 'ACWR = \\frac{Load_{7d}}{Load_{28d}/4}',
    unit: 'AU (Arbitrary Units)',
    dataSources: ['Banco Invictus (Workouts)', 'Frequência Cardíaca (Sensor)'],
    howObtained: 'Calculado pelo motor analítico do Invictus ponderando duração e frequência cardíaca.',
    deviceTypes: ['Servidor Invictus Core'],
    updateFrequency: 'Semanal',
    minConditions: 'Mínimo de 14 dias de treinos registrados para modelo preditivo.',
    storageAndHistory: 'Atualizado semanalmente no perfil do atleta.',
    displayMethod: 'Gauge / Radial',
    aiUsage: 'Permite à IA emitir alertas preventivos como "Carga Aguda alta: Reduza a intensidade hoje".',
    insufficientDataBehavior: 'Informa "Acumule 2 semanas de treino para ativar a Carga ACWR".'
  },

  // 4. RECOVERY
  {
    id: 'recovery_index',
    category: 'recovery',
    name: 'Índice de Prontidão e Recuperação (0-100)',
    objective: 'Indicar o nível de prontidão do organismo para absorver uma nova carga de treino.',
    simpleDescription: 'Nota de 0 a 100 que diz o quanto seu corpo está descansado e pronto para treinar forte.',
    technicalDescription: 'Algoritmo proprietário combinando o intervalo de tempo desde o último treino, variação de batimento basal e consistência de descanso.',
    formula: 'Rec = 100 - \\left( \\frac{\\text{Fadiga Acumulada}}{\\text{Horas de Descanso}} \\times 10 \\right)',
    unit: 'pts (0-100)',
    dataSources: ['Banco Invictus (Workouts)', 'Frequência Cardíaca (Sensor)', 'Wearables / Garmin / Whoop'],
    howObtained: 'Consolidação de dados biométricos do relógio e horários de término das últimas sessões.',
    deviceTypes: ['Smartwatch', 'Whoop', 'Oura Ring', 'Invictus Analytics'],
    updateFrequency: 'Diária',
    minConditions: 'Ao menos 1 treino nos últimos 5 dias.',
    storageAndHistory: 'Pontuação diária registrada no histórico de biometria.',
    displayMethod: 'Gauge / Radial',
    aiUsage: 'Usado pela IA para sugerir treinos intensos (quando >80) ou regenerativos (quando <45).',
    insufficientDataBehavior: 'Exibe status "Padrão neutro (Sem treinos recentes registrados)".'
  },
  {
    id: 'rest_interval_hours',
    category: 'recovery',
    name: 'Tempo de Descanso Desde o Último Treino',
    objective: 'Monitorar a janela de regeneração muscular entre estímulos.',
    simpleDescription: 'Quantas horas se passaram desde o término da sua última atividade física.',
    technicalDescription: 'Diferença em horas decimais entre a hora atual t_now e o timestamp_end do último treino validado.',
    formula: '\\Delta t_{descanso} = \\frac{t_{now} - t_{last\_workout}}{3600}',
    unit: 'horas',
    dataSources: ['Banco Invictus (Workouts)'],
    howObtained: 'Subtração simples entre horário atual e registro mais recente na coleção de workouts.',
    deviceTypes: ['App Mobile Invictus'],
    updateFrequency: 'Tempo Real',
    minConditions: 'Ao menos 1 treino no histórico.',
    storageAndHistory: 'Calculado em tempo real no app.',
    displayMethod: 'Card Metric + Badge',
    aiUsage: 'Instrui a IA se o atleta está descansando o suficiente ou realizando treinos em horários perigosamente próximos.',
    insufficientDataBehavior: 'Mostra "Nenhum treino registrado ainda".'
  },

  // 5. CONSISTENCY
  {
    id: 'weekly_active_days',
    category: 'consistency',
    name: 'Dias Ativos na Semana (Fn IGA)',
    objective: 'Verificar a distribuição dos treinos ao longo dos dias da semana.',
    simpleDescription: 'Quantidade de dias diferentes na semana atual em que você realizou treinos validados.',
    technicalDescription: 'Cardinalidade do conjunto de dias únicos (segunda a domingo) com no mínimo 1 treino aprovado no motor IGA (máximo 5 elegíveis).',
    formula: 'F = |\\{ \\text{dia} \\in \\text{Semana} \\mid \\text{Count(Treinos) } \\ge 1 \\}|',
    unit: 'dias/sem',
    dataSources: ['Banco Invictus (Workouts)', 'Check-in de Presença (GPS/Gym)'],
    howObtained: 'Verificação diária dos registros do usuário no Firestore.',
    deviceTypes: ['App Mobile', 'GPS', 'Gym Checkin'],
    updateFrequency: 'Diária',
    minConditions: 'Sempre disponível.',
    storageAndHistory: 'Salvo em `igaAudit` semanal e histórico do usuário.',
    displayMethod: 'Progress Bar',
    aiUsage: 'Crucial para a IA projetar a pontuação no Ranking Semanal IGA e incentivar a constância.',
    insufficientDataBehavior: 'Mostra 0/5 dias ativos na semana atual com dicas de como pontuar.'
  },
  {
    id: 'current_streak_days',
    category: 'consistency',
    name: 'Sequência de Treino Atual (Streak)',
    objective: 'Engajar e medir o hábito contínuo de treinos sem interrupção.',
    simpleDescription: 'Número de semanas ou dias consecutivos mantendo a meta de atividade.',
    technicalDescription: 'Contador incremental de dias/semanas consecutivas com atividade física aprovada.',
    formula: 'Streak = \\text{Contagem de dias sem gap } > 48h',
    unit: 'dias seguidos',
    dataSources: ['Banco Invictus (Workouts)', 'Check-in de Presença (GPS/Gym)'],
    howObtained: 'Calculado no perfil do usuário durante o envio de workouts.',
    deviceTypes: ['App Invictus'],
    updateFrequency: 'Diária',
    minConditions: 'Qualquer atividade aprovada.',
    storageAndHistory: 'Salvo em `user.streak` e `user.longestStreak`.',
    displayMethod: 'Card Metric + Badge',
    aiUsage: 'Identifica atletas hiper-engajados para premiar ou alertar se o risco de burnout subir.',
    insufficientDataBehavior: 'Exibe 0 dias com convite a iniciar sua sequência hoje.'
  },

  {
    id: 'consistency_index',
    category: 'consistency',
    name: 'Índice de Consistência',
    objective: 'Medir o quanto o atleta se manteve ativo no período em relação à meta de dias elegíveis do IGA.',
    simpleDescription: 'Percentual de dias ativos que você teve no período, comparado à meta de até 5 dias/semana que vale pontos no ranking.',
    technicalDescription: 'Razão entre o número de dias distintos com ao menos 1 treino validado no período e a meta de dias elegíveis (5 dias/semana, o mesmo teto usado pela Frequência (Fn) do IGA), limitada a 100%.',
    formula: 'Consistência = \\min\\left(100, \\frac{DiasAtivos}{Semanas_{periodo} \\times 5} \\times 100\\right)',
    unit: '%',
    dataSources: ['Banco Invictus (Workouts)', 'Check-in de Presença (GPS/Gym)'],
    howObtained: 'Contagem de dias distintos com treino validado no período selecionado, dividida pela meta de 5 dias/semana do IGA.',
    deviceTypes: ['App Mobile Invictus'],
    updateFrequency: 'Diária',
    minConditions: 'Período selecionado de ao menos 7 dias com pelo menos 1 treino validado.',
    storageAndHistory: 'Calculado dinamicamente sobre o histórico validado do período.',
    displayMethod: 'Progress Bar',
    aiUsage: 'A IA usa este índice para identificar quedas de hábito antes que afetem a pontuação semanal.',
    insufficientDataBehavior: 'Exibe "Selecione um período de ao menos 7 dias com treinos" sem números fictícios.'
  },

  // 6. RECORDS & EVOLUTION
  {
    id: 'personal_best_workout_duration',
    category: 'records_evolution',
    name: 'Recorde Pessoal: Maior Tempo em uma Sessão',
    objective: 'Registrar o maior feito de volume único do atleta na sua jornada.',
    simpleDescription: 'O treino mais longo que você já realizou no aplicativo.',
    technicalDescription: 'Valor máximo de duração t_i entre todos os treinos históricos registrados.',
    formula: 'PR_{tempo} = \\max_{i=1..N} \\{ duration_i \\}',
    unit: 'minutos',
    dataSources: ['Banco Invictus (Workouts)'],
    howObtained: 'Comparação automática a cada novo treino submetido.',
    deviceTypes: ['App Invictus Engine'],
    updateFrequency: 'Tempo Real',
    minConditions: 'Ao menos 1 treino validado.',
    storageAndHistory: 'Salvo permanentemente na Timeline de Conquistas.',
    displayMethod: 'Card Metric + Badge',
    aiUsage: 'Permite à IA comemorar novas conquistas e marcos históricos.',
    insufficientDataBehavior: 'Apresenta "Disponível após o 1º treino".'
  },
  {
    id: 'best_iga_weekly_score',
    category: 'records_evolution',
    name: 'Recorde de Pontuação Semanal (Melhor IGA Histórico)',
    objective: 'Guardar o ápice de pontuação científica atingida pelo atleta em uma semana.',
    simpleDescription: 'Sua maior pontuação no Ranking Invictus até hoje.',
    technicalDescription: 'Máximo valor do indicador IGA = 100 * (Fn * Tn * In)^(1/3) calculado em qualquer semana concluída.',
    formula: 'PR_{IGA} = \\max_{semanas} \\{ IGA_{semana} \\}',
    unit: 'pts',
    dataSources: ['Banco Invictus (Workouts)', 'Servidor IGA Engine'],
    howObtained: 'Auditado no fechamento semanal das ligas.',
    deviceTypes: ['Servidor Invictus Core'],
    updateFrequency: 'Semanal',
    minConditions: 'Pelo menos 1 semana concluída no app.',
    storageAndHistory: 'Armazenado no documento de perfil e na linha do tempo.',
    displayMethod: 'Card Metric + Badge',
    aiUsage: 'Referência de pico de forma para a IA comparar a performance atual do usuário.',
    insufficientDataBehavior: 'Mostra "Aguardando conclusão da 1ª semana".'
  },

  // 7. RANKING & IGA
  {
    id: 'iga_weekly_score',
    category: 'ranking_iga',
    name: 'Pontuação IGA Semanal Oficial (Ranking)',
    objective: 'Calcular a pontuação justa e científica do atleta no Ranking Semanal.',
    simpleDescription: 'Sua nota oficial no ranking, baseada em Frequência, Tempo e Intensidade.',
    technicalDescription: 'Média geométrica das variáveis normalizadas: IGA Base = 100 * (Fn * Tn * In)^(1/3), multiplicada pelo Gate de Calorias e Handicap de Idade.',
    formula: 'IGA = 100 \\times (F_n \\times T_n \\times I_n)^{1/3} \\times Gate \\times Handicap',
    unit: 'pts',
    dataSources: ['Banco Invictus (Workouts)', 'Frequência Cardíaca (Sensor)', 'Check-in de Presença (GPS/Gym)'],
    howObtained: 'Calculado pelo motor IGA do backend Invictus a cada atividade.',
    deviceTypes: ['Servidor Invictus Engine'],
    updateFrequency: 'Tempo Real',
    minConditions: 'Treino ou presença registrada na semana corrente.',
    storageAndHistory: 'Atualizado em `user.weeklyScore` e detalhado no modal de auditoria IGA.',
    displayMethod: 'Card Metric + Badge',
    aiUsage: 'Base principal para análises de classificação no ranking e projeção de ligas.',
    insufficientDataBehavior: 'Exibe 0 pts e explica como acumular os primeiros pontos IGA.'
  },

  // 8. PROJECTIONS
  {
    id: 'projected_monthly_workouts',
    category: 'projections',
    name: 'Projeção de Treinos para o Fim do Mês',
    objective: 'Estimar a quantidade final de treinos no mês corrente mantendo o ritmo atual.',
    simpleDescription: 'Quantos treinos você terá no final do mês se mantiver a frequência desta semana.',
    technicalDescription: 'Projeção linear baseada na taxa média de treinos/dia no mês atual multiplicada pelo total de dias no mês.',
    formula: 'N_{proj} = \\text{Round}\\left( \\frac{N_{mes\_atual}}{Dia_{atual}} \\times Dias_{total\_mes} \\right)',
    unit: 'treinos projetados',
    dataSources: ['Banco Invictus (Workouts)'],
    howObtained: 'Extrapolação estatística calculada sobre o calendário corrente.',
    deviceTypes: ['App Analytics Engine'],
    updateFrequency: 'Diária',
    minConditions: 'Pelo menos 3 dias transcorridos no mês atual.',
    storageAndHistory: 'Recalculado diariamente.',
    displayMethod: 'Progress Bar',
    aiUsage: 'A IA utiliza para projetar se o usuário alcançará sua meta mensal ou se precisa acelerar.',
    insufficientDataBehavior: 'Informa "Inicia no 3º dia do mês".'
  }
];

export function getMetricsByCategory(category: PerformanceMetricDef['category']): PerformanceMetricDef[] {
  return METRIC_CATALOG.filter(m => m.category === category);
}

export function getMetricById(id: string): PerformanceMetricDef | undefined {
  return METRIC_CATALOG.find(m => m.id === id);
}
