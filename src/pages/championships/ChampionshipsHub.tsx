import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Calendar,
  ShieldCheck,
  ExternalLink
} from 'lucide-react';
import { championshipService } from '../../services/championshipService';
import { useUser } from '../../UserContext';
import { getNextSeasonCountdown } from '../../lib/seasonUtils';

// As inscricoes da Liga Invictus sao feitas no site oficial, fora do app --
// nao existe (ainda) um fluxo de checkout dentro do proprio app pra essa
// temporada. Se isso mudar, e so trocar por uma rota interna.
const INSCRICAO_URL = 'https://www.invictusperformance.app.br/';

// #235: cada uma destas 4 colunas ocupa ~48px de largura REAL num celular
// (o banner inteiro tem ~358px e as 4 colunas dividem pouco mais da metade
// dele). Nesse espaco, o rotulo de duas palavras + a descricao so cabiam em
// fonte de ~7px renderizados -- ilegivel, exatamente a reclamacao registrada.
//
// Por isso cada item ganhou uma versao `curta`: no celular aparece so ela,
// num corpo que da para ler; em telas largas o rotulo completo e a descricao
// continuam aparecendo. A troca e feita no CSS (.iv-camp-banner__rec-*), sem
// remover informacao -- os 4 icones da arte seguem comunicando o conceito.
const RECURSOS = [
  { Icon: Target, className: 'iv-camp-banner__rec--1', label: ['TREINE COM', 'PROPÓSITO'], curta: 'PONTOS', desc: 'Cada treino conta pontos.' },
  { Icon: TrendingUp, className: 'iv-camp-banner__rec--2', label: ['COMPITA DE', 'VERDADE'], curta: 'RANKING', desc: 'Ranking com seu nível.' },
  { Icon: Trophy, className: 'iv-camp-banner__rec--3', label: ['PREMIAÇÕES', 'REAIS'], curta: 'PRÊMIOS', desc: 'Os melhores são premiados.' },
  { Icon: Users, className: 'iv-camp-banner__rec--4', label: ['COMUNIDADE', 'ÉLITE'], curta: 'ELITE', desc: 'Só quem é consistente.' }
] as const;

export const ChampionshipsHub: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const [tab, setTab] = useState<'liga' | 'meus'>('liga');
  const [countdown, setCountdown] = useState(getNextSeasonCountdown());

  useEffect(() => {
    const timer = setInterval(() => setCountdown(getNextSeasonCountdown()), 1000);
    return () => clearInterval(timer);
  }, []);

  const userRegistrations = championshipService.getUserRegistrations(user?.uid);
  const hasActiveRegistrations = userRegistrations.some((r) => r.status === 'ACTIVE');

  return (
    <div className="w-full min-h-screen bg-transparent text-white pb-28 pt-3 px-3.5 sm:px-5 max-w-md mx-auto select-none">
      {/* Cabecalho */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer shrink-0"
            aria-label="Voltar para Início"
          >
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-xl font-bold tracking-wider font-bebas text-white uppercase m-0 leading-tight truncate">
            CAMPEONATOS
          </h1>
        </div>

        {/* Leva pro site oficial -- ainda nao existe uma pagina de regras
            geral dentro do app pra Liga Invictus (as unicas paginas de
            regulamento hoje pedem o id de um campeonato especifico). */}
        <a
          href={INSCRICAO_URL}
          target="_blank"
          rel="noreferrer"
          className="w-9 h-9 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all cursor-pointer shrink-0"
          aria-label="Saiba mais"
        >
          <Info size={18} />
        </a>
      </div>

      {/* Abas */}
      <div className="iv-abas mb-5">
        <button
          className={tab === 'liga' ? 'iv-aba--ativa' : 'iv-aba--inativa'}
          onClick={() => setTab('liga')}
        >
          LIGA INVICTUS
        </button>
        <button
          className={tab === 'meus' ? 'iv-aba--ativa' : 'iv-aba--inativa'}
          onClick={() => setTab('meus')}
        >
          MEUS CAMPEONATOS
        </button>
      </div>

      {tab === 'liga' ? (
        <div className="flex flex-col gap-4">
          {/* Banner: arte sem texto (banner_campeonato_base) + escrita real
              em HTML por cima. Medidas e comentarios em invictus.css. */}
          <section className="iv-camp-banner">
            <img
              src="/assets/championships/banner_campeonato_base.webp"
              alt="Na Invictus, sua disciplina se torna recompensa"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.src.endsWith('.png')) {
                  target.src = '/assets/championships/banner_campeonato_base.png';
                }
              }}
            />
            <div className="iv-camp-banner__texto">
              <span className="iv-camp-banner__kicker">Na Invictus,</span>

              <div className="iv-camp-banner__titulo">
                <span className="l1">Sua disciplina</span>
                <span className="l2">Se torna recompensa.</span>
              </div>

              <div className="iv-camp-banner__faixa">
                <span className="l1">Um campeonato que transforma</span>
                <span className="l2">Esforço em premiações reais.</span>
              </div>

              {RECURSOS.map(({ Icon, className, label, curta, desc }) => (
                <div key={className} className={`iv-camp-banner__rec ${className}`}>
                  <b className="iv-camp-banner__rec-longo">
                    {label.map((line) => (
                      <React.Fragment key={line}>
                        {line}
                        <br />
                      </React.Fragment>
                    ))}
                  </b>
                  <b className="iv-camp-banner__rec-curto">{curta}</b>
                  <p>{desc}</p>
                </div>
              ))}

              <div className="iv-camp-banner__cta">
                Não é só treinar. <b>É superar. É evoluir.</b> É ser reconhecido.
              </div>
            </div>
          </section>

          {/* A temporada ainda nao comecou -- contador real, mesma fonte
              (getNextSeasonCountdown) que ja alimenta o banner da Home. */}
          <section className="iv-card flex items-center gap-3 !p-3.5">
            <div className="iv-icone-circulo">
              <Calendar size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="iv-titulo text-[14px] leading-tight">
                A TEMPORADA AINDA NÃO COMEÇOU!
              </p>
              <p className="iv-texto text-[12px] mt-1">
                Faltam {countdown.time.days}d {countdown.time.hours}h. Prepare-se e conecte seus dispositivos.
              </p>
            </div>
            <span className="iv-chip shrink-0 text-center leading-tight whitespace-normal">
              EM BREVE
              <br />
              NOVA TEMPORADA
            </span>
          </section>

          {/* Pronto para fazer parte: arte sem texto (card_inscricao_base)
              + texto e botao reais por cima. A inscricao e feita no site
              oficial (MobileBridge.tsx abre links externos no navegador
              nativo automaticamente). */}
          <a
            href={INSCRICAO_URL}
            target="_blank"
            rel="noreferrer"
            className="iv-camp-cta block cursor-pointer active:scale-[0.98] transition-transform"
          >
            <img
              src="/assets/championships/card_inscricao_base.webp"
              alt="Pronto para fazer parte?"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.src.endsWith('.png')) {
                  target.src = '/assets/championships/card_inscricao_base.png';
                }
              }}
            />
            <div className="iv-camp-cta__titulo">
              <span className="l1">Pronto para</span>
              <span className="l2">Fazer parte?</span>
            </div>
            <p className="iv-camp-cta__texto">
              As inscrições são feitas pelo site. Garanta sua participação e esteja entre os que treinam com propósito.
            </p>
            <span className="iv-camp-cta__botao">
              FAZER INSCRIÇÃO
              <ExternalLink />
            </span>
          </a>

          {/* Justo, transparente e seguro */}
          <a
            href={INSCRICAO_URL}
            target="_blank"
            rel="noreferrer"
            className="iv-card flex items-center gap-3 !p-3.5"
          >
            <div className="iv-icone-circulo">
              <ShieldCheck size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="iv-titulo text-[14px] leading-tight">
                JUSTO, TRANSPARENTE E SEGURO
              </p>
              <p className="iv-texto text-[12px] mt-1 line-clamp-2">
                Todos os treinos passam por validações rigorosas para garantir uma competição limpa e justa.
              </p>
            </div>
            <ChevronRight size={18} className="text-[var(--dourado)] shrink-0" />
          </a>
        </div>
      ) : (
        <div className="rounded-[18px] bg-[#121113] border border-zinc-800/80 p-3.5 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-400 shrink-0">
              <Trophy size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-300 font-sans leading-tight">
                {hasActiveRegistrations
                  ? 'Você possui inscrições ativas em andamento.'
                  : 'Você ainda não está inscrito em nenhum campeonato.'}
              </p>
            </div>
          </div>

          <button
            onClick={() => navigate('/championships/my')}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-amber-500/30 text-amber-400 text-[11px] font-bold font-bebas tracking-wide shrink-0 transition-colors cursor-pointer"
          >
            {hasActiveRegistrations ? 'MEUS ATIVOS' : 'VER ATIVOS'}
          </button>
        </div>
      )}
    </div>
  );
};
