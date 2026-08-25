import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaFire,
  FaStar,
  FaDumbbell,
  FaPersonRunning,
  FaArrowRight,
  FaTrophy
} from 'react-icons/fa6';
import { useUser } from '../UserContext';
import { workoutService } from '../services/workoutService';
import { getXPProgress } from '../lib/levelUtils';
import { getNextSeasonCountdown } from '../lib/seasonUtils';
import { Workout } from '../types';
import './Home.css';

export function Home() {
  const navigate = useNavigate();
  const { user } = useUser();

  const [countdown, setCountdown] = useState(getNextSeasonCountdown());
  const [recentActivities, setRecentActivities] = useState<Workout[]>([]);

  // Update countdown every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(getNextSeasonCountdown());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch real activities to calculate XP earned today
  useEffect(() => {
    let isMounted = true;
    if (user?.uid) {
      workoutService
        .getUserWorkouts(20)
        .then((workouts) => {
          if (isMounted) {
            setRecentActivities(workouts || []);
          }
        })
        .catch((err) => {
          console.error('[Home] Error fetching user workouts:', err);
        });
    }
    return () => {
      isMounted = false;
    };
  }, [user?.uid]);

  // Calculate real XP earned today from real workouts
  const todayStr = new Date().toLocaleDateString('sv-SE');
  const todayWorkouts = recentActivities.filter(
    (w) =>
      w.timestamp &&
      new Date(w.timestamp).toLocaleDateString('sv-SE') === todayStr
  );
  const xpToday = todayWorkouts.reduce(
    (sum, w) => sum + (Number(w.points) || (w as any).xp || 0),
    0
  );

  // User details
  const userXP = Number(user?.xp) || 0;
  const xpProgress = getXPProgress(userXP);
  const userLevel = xpProgress.currentLevel;

  const isPaidUser =
    user?.subscriptionTier === 'performance' ||
    user?.currentPlan === 'performance' ||
    user?.isSubscribed === true ||
    user?.premium === true;

  // First name extraction
  const rawName = user?.displayName || user?.name || 'ATLETA';
  const firstName = rawName.trim().split(' ')[0].toUpperCase();

  // Dynamic greeting by hour with comma
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'BOM DIA,';
    if (hour >= 12 && hour < 18) return 'BOA TARDE,';
    return 'BOA NOITE,';
  };

  // Daily challenges configuration using verified app modules
  const dailyChallenges = [
    {
      id: 'workout',
      title: 'TREINO DE MUSCULAÇÃO',
      description: 'Inicie o treino para validar sua presença na academia',
      xp: 100,
      icon: FaDumbbell,
      path: '/challenges?type=workout'
    },
    {
      id: 'cardio',
      title: 'CARDIO AERÓBICO',
      description: 'Corrida ou caminhada ao ar livre via GPS',
      xp: 80,
      icon: FaPersonRunning,
      path: '/challenges?type=cardio'
    }
  ];

  return (
    <div
      id="home-screen-root"
      className="iv-fundo w-full text-white relative px-0 select-none overflow-x-hidden"
    >
      <div
        id="home-content-wrapper"
        className="iv-conteudo w-full max-w-md mx-auto flex flex-col gap-4"
      >
        {/* 0) CABEÇALHO — capacete e assinatura.
            Na arte o capacete tem 52px de altura e o conteúdo só começa a
            167px do topo. Esse vão é o que deixa o espartano do fundo
            aparecer, mas 167px fixos empurrariam "DESAFIOS DE HOJE" para fora
            da primeira dobra num celular pequeno. Por isso o respiro é
            proporcional com teto e piso: acompanha a arte em tela grande e
            protege a dobra em tela pequena. */}
        <header
          id="home-header"
          className="w-full flex flex-col items-center shrink-0"
          style={{
            // A Home zera o padding do Layout, entao a area segura passa a ser
            // responsabilidade daqui: sem isso o capacete entra embaixo do
            // notch e da barra de status.
            paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
            marginBottom: 'clamp(12px, 7vh, 65px)'
          }}
        >
          <img
            src="/capacete.webp"
            alt="Invictus"
            width={30}
            height={52}
            className="h-[52px] w-auto select-none pointer-events-none"
            style={{ filter: 'drop-shadow(0 0 18px rgba(241,190,34,0.35))' }}
            onError={(e) => {
              const target = e.currentTarget;
              if (!target.src.endsWith('/capacete.png')) {
                target.src = '/capacete.png';
              }
            }}
          />
          <p
            className="font-barlow font-bold text-[13px] text-white uppercase mt-2 leading-none"
            style={{ letterSpacing: '0.16em' }}
          >
            Invictus Performance
          </p>
        </header>

        {/* 1) CARD DE SAUDAÇÃO (Retângulo Padrão) */}
        <section
          id="home-greeting-card"
          className="iv-card w-full flex items-center gap-4 !p-4"
        >
          {/* Avatar circular + Badges Empilhados */}
          <div className="flex flex-col items-center shrink-0 gap-2">
            <button
              id="home-avatar-btn"
              onClick={() => navigate('/profile')}
              aria-label="Ver perfil"
              className="rounded-full shrink-0 flex items-center justify-center relative cursor-pointer active:scale-95 transition-transform"
              style={{
                // Anel de metal, nao cor chapada. Amostrado a cada 20 graus na
                // arte: o brilho fica no TOPO e chega quase a branco (#FDFCC8),
                // fechando em ambar escuro embaixo a direita (#D29603). Um
                // box-shadow de cor unica nao tem como reproduzir isso -- era
                // o que faltava de "vida".
                // Diametro externo 74, anel 4, foto 66. Tudo medido.
                width: '74px',
                height: '74px',
                borderRadius: '50%',
                padding: '4px',
                background: `conic-gradient(from 0deg,
                  #FDD935 0deg, #FDFCC8 12deg, #FFF053 50deg, #FEDA33 70deg,
                  #FFB11F 90deg, #F5A914 130deg, #D29603 152deg, #DBAA00 190deg,
                  #E68800 210deg, #FDB820 230deg, #FA8406 250deg, #FDB11E 270deg,
                  #FFDC2E 310deg, #FCD71D 330deg, #FDD935 360deg)`,
                boxShadow: '0 0 14px rgba(253,217,53,0.50), 0 0 34px rgba(241,190,34,0.28)'
              }}
            >
              <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center">
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={rawName}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center iv-titulo text-2xl text-black"
                    style={{ background: 'var(--dourado)' }}
                  >
                    {firstName.charAt(0) || 'A'}
                  </div>
                )}
              </div>
            </button>

            {/* Badges Empilhados: LVL X e PRO */}
            <div className="flex flex-col items-center gap-1 w-full">
              <span
                id="home-level-badge"
                className="iv-chip tracking-wider"
              >
                LVL {userLevel}
              </span>

              {isPaidUser && (
                <span
                  id="home-pro-badge"
                  className="iv-chip tracking-wider"
                >
                  PRO
                </span>
              )}
            </div>
          </div>

          {/* Dados Textuais à Direita */}
          <div className="flex flex-col flex-1 min-w-0 justify-center">
            {/* Saudação por Horário */}
            <span
              id="home-greeting-text"
              className="iv-titulo text-[20px] leading-none"
            >
              {getGreeting()}
            </span>

            {/* Primeiro Nome */}
            <h1
              id="home-user-name"
              className="iv-titulo--branco truncate max-w-full my-1"
              style={{
                fontSize: 'clamp(32px, 9vw, 44px)',
                lineHeight: 0.95
              }}
              title={firstName}
            >
              {firstName}
            </h1>

            {/* XP Atual / XP Necessário */}
            <span
              id="home-xp-summary"
              className="font-barlow font-semibold text-[15px] text-white mt-0.5 mb-1.5"
            >
              {userXP.toLocaleString('pt-BR')} / {xpProgress.xpCeiling.toLocaleString('pt-BR')} XP
            </span>

            {/* Barra de Progresso + Porcentagem */}
            <div className="flex items-center gap-2.5 w-full">
              <div
                id="home-xp-bar-track"
                className="iv-barra flex-1"
              >
                <span
                  id="home-xp-bar-fill"
                  className="transition-all duration-700 ease-out"
                  style={{
                    width: `${Math.min(100, Math.max(0, xpProgress.percentage))}%`
                  }}
                />
              </div>

              <span
                id="home-xp-percentage"
                className="font-barlow font-bold text-[14px] shrink-0"
                style={{ color: 'var(--dourado-claro)' }}
              >
                {Math.round(xpProgress.percentage)}%
              </span>
            </div>
          </div>
        </section>

        {/* 2) DUAS PÍLULAS (SEQUÊNCIA e XP HOJE) */}
        <section
          id="home-stat-pills"
          className="grid grid-cols-2 gap-3 w-full"
        >
          {/* Pílula Esquerda: Sequência */}
          <div
            id="home-streak-pill"
            className="iv-card !p-3.5 flex items-center gap-3"
          >
            {/* Círculo de 44px à esquerda */}
            <div className="iv-icone-circulo">
              <FaFire size={20} />
            </div>
            {/* Coluna alinhada à esquerda */}
            <div className="flex flex-col items-start text-left min-w-0">
              <span
                id="home-streak-value"
                className="iv-titulo text-[22px] leading-tight text-white"
              >
                {user?.streak ?? 0}
              </span>
              <span className="iv-rotulo leading-none">
                SEQUÊNCIA
              </span>
            </div>
          </div>

          {/* Pílula Direita: XP Hoje */}
          <div
            id="home-today-xp-pill"
            className="iv-card !p-3.5 flex items-center gap-3"
          >
            {/* Círculo de 44px à esquerda */}
            <div className="iv-icone-circulo">
              <FaStar size={20} />
            </div>
            {/* Coluna alinhada à esquerda */}
            <div className="flex flex-col items-start text-left min-w-0">
              <span
                id="home-today-xp-value"
                className="iv-titulo text-[22px] leading-tight text-white"
              >
                +{xpToday}
              </span>
              <span className="iv-rotulo leading-none">
                XP HOJE
              </span>
            </div>
          </div>
        </section>

        {/* 3) BANNER OFICIAL: POWER LIFT & CAMPEONATOS INVICTUS */}
        <section
          id="home-championships-banner-card"
          onClick={() => navigate('/championships')}
          className="w-full rounded-[24px] overflow-hidden bg-[#121113]/95 border border-amber-500/40 shadow-2xl relative cursor-pointer active:scale-[0.98] transition-all hover:border-amber-400 group"
        >
          {/* Banner Oficial Responsivo */}
          <div className="relative w-full aspect-[3/2] overflow-hidden bg-black/80">
            <img
              src="/assets/championships/banner_home_power_lift.webp"
              alt="BANNER HOME POWER LIFT"
              className="w-full h-full object-cover object-center group-hover:scale-[1.02] transition-transform duration-300"
              referrerPolicy="no-referrer"
              onError={(e) => {
                // Fallback para PNG caso o navegador antigo prefira
                const target = e.currentTarget;
                if (!target.src.endsWith('.png')) {
                  target.src = '/assets/championships/banner_home_power_lift.png';
                }
              }}
            />
            {/* Efeito de borda interna */}
            <div className="absolute inset-0 ring-1 ring-inset ring-white/10 pointer-events-none" />
          </div>

          {/* Destaques Rápidos com Emojis (Musculação + Corrida) */}
          <div className="p-3 bg-gradient-to-b from-[#18161b] to-[#100f12] border-t border-amber-500/20 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="flex items-center gap-2 bg-black/40 border border-zinc-800/80 rounded-xl px-2.5 py-1.5">
              <span className="text-sm">🛡️</span>
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-zinc-200 block uppercase tracking-wider leading-tight">Regras Claras</span>
                <span className="text-[8.5px] text-zinc-400 block leading-tight">Competição justa</span>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-black/40 border border-zinc-800/80 rounded-xl px-2.5 py-1.5">
              <span className="text-sm">📊</span>
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-zinc-200 block uppercase tracking-wider leading-tight">Rankings ao Vivo</span>
                <span className="text-[8.5px] text-zinc-400 block leading-tight">Sua evolução</span>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-black/40 border border-zinc-800/80 rounded-xl px-2.5 py-1.5">
              <span className="text-sm">🏆</span>
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-[#ffb000] block uppercase tracking-wider leading-tight">Premiações</span>
                <span className="text-[8.5px] text-zinc-400 block leading-tight">Para os melhores</span>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-black/40 border border-zinc-800/80 rounded-xl px-2.5 py-1.5">
              <span className="text-sm">👥</span>
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-teal-300 block uppercase tracking-wider leading-tight">Desafie Atletas</span>
                <span className="text-[8.5px] text-zinc-400 block leading-tight">De todo o Brasil</span>
              </div>
            </div>
          </div>
        </section>

        {/* 4) SEÇÃO DESAFIOS DE HOJE */}
        <section id="home-challenges-section" className="w-full flex flex-col gap-3">
          {/* Cabeçalho da Seção */}
          <div className="flex items-center justify-between">
            <h3
              className="iv-titulo text-[22px] tracking-wide"
            >
              DESAFIOS DE HOJE
            </h3>

            <span
              id="home-challenges-counter-chip"
              className="iv-chip"
            >
              {dailyChallenges.length} DISPONÍVEIS
            </span>
          </div>

          {/* Lista de Desafios */}
          <div className="flex flex-col gap-3">
            {dailyChallenges.map((challenge) => {
              const IconComp = challenge.icon;
              return (
                <div
                  key={challenge.id}
                  id={`home-challenge-item-${challenge.id}`}
                  onClick={() => navigate(challenge.path)}
                  className="iv-card !p-3.5 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
                >
                  {/* Círculo de 46px à esquerda */}
                  <div
                    className="iv-icone-circulo !w-[46px] !h-[46px] !min-w-[46px] !max-w-[46px]"
                  >
                    <IconComp size={20} />
                  </div>

                  {/* Nome e Descrição Curta */}
                  <div className="flex flex-col flex-1 min-w-0">
                    <span
                      className="font-barlow font-bold text-[15px] uppercase text-white truncate"
                      title={challenge.title}
                    >
                      {challenge.title}
                    </span>
                    <span
                      className="iv-texto line-clamp-1"
                    >
                      {challenge.description}
                    </span>
                  </div>

                  {/* Chip de XP */}
                  <div
                    className="shrink-0 flex items-center justify-center font-barlow font-bold text-[14px] rounded-xl px-3.5 py-2 text-[var(--dourado-claro)] border border-[var(--dourado)]"
                  >
                    +{challenge.xp} XP
                  </div>
                </div>
              );
            })}
          </div>

          {/* Link Ver Todos os Desafios */}
          <button
            id="home-view-all-challenges"
            onClick={() => navigate('/challenges')}
            className="w-full flex items-center justify-center gap-2 py-3 mt-1 cursor-pointer group active:scale-95 transition-transform"
          >
            <span
              className="font-barlow font-bold text-[13px] uppercase tracking-wider text-[var(--dourado)] group-hover:underline"
            >
              VER TODOS OS DESAFIOS
            </span>
            <FaArrowRight
              size={16}
              className="text-[var(--dourado)] drop-shadow-[0_0_6px_rgba(241,190,34,0.55)] group-hover:translate-x-1 transition-transform"
            />
          </button>
        </section>
      </div>
    </div>
  );
}

export default Home;
