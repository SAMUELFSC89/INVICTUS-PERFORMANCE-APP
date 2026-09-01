import { motion } from 'framer-motion';
import { Crown, Trophy, Flame, Sparkles, CheckCircle, Calendar, Milestone, ShieldCheck } from 'lucide-react';
import { TimelineEvent } from '../../core/performance/performanceEngine';

interface TimelineViewProps {
  events: TimelineEvent[];
  userName: string;
}

export function TimelineView({ events, userName }: TimelineViewProps) {
  const getIcon = (type: TimelineEvent['iconType']) => {
    switch (type) {
      case 'crown':
        return <Crown size={18} className="text-amber-400" />;
      case 'trophy':
        return <Trophy size={18} className="text-emerald-400" />;
      case 'flame':
        return <Flame size={18} className="text-amber-500" />;
      case 'sparkles':
        return <Sparkles size={18} className="text-blue-400" />;
      case 'check':
      default:
        return <CheckCircle size={18} className="text-emerald-400" />;
    }
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h3 className="font-headline italic font-black text-xl uppercase tracking-tight text-white flex items-center gap-2">
            <Milestone size={22} className="text-emerald-400" />
            <span>Linha do Tempo Permanente de Performance</span>
          </h3>
          <p className="text-xs text-zinc-400">
            Registro histórico inalterável de marcos e recordes de {userName}
          </p>
        </div>
        <div className="text-right hidden sm:block">
          <span className="text-xs font-mono text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
            {events.length} Eventos Registrados
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="py-12 text-center text-zinc-500 space-y-2">
          <Calendar size={36} className="mx-auto text-zinc-700" />
          <p className="font-medium text-sm">Sua linha do tempo está pronta para registrar suas conquistas.</p>
          <p className="text-xs text-zinc-600">Conclua seu primeiro treino para gravar o marco inicial.</p>
        </div>
      ) : (
        <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-gradient-to-b before:from-emerald-500 before:via-zinc-800 before:to-zinc-900">
          {events.map((evt, idx) => (
            <motion.div
              key={evt.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="relative group"
            >
              {/* Dot Icon Indicator */}
              <div className="absolute -left-6 top-0.5 w-6 h-6 rounded-full bg-zinc-950 border-2 border-emerald-500 flex items-center justify-center text-emerald-400 shadow-md shadow-emerald-500/20">
                {getIcon(evt.iconType)}
              </div>

              {/* Event Card */}
              <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800/80 hover:border-emerald-500/40 transition-all space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-headline italic font-black text-sm text-white uppercase tracking-tight">
                      {evt.title}
                    </span>
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                      {evt.badgeText}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-500 font-medium">
                    {evt.date}
                  </span>
                </div>

                <p className="text-xs text-zinc-300 leading-relaxed font-medium">
                  {evt.description}
                </p>

                <div className="pt-2 flex items-center gap-2 text-[10px] text-zinc-500 font-mono border-t border-zinc-900">
                  <ShieldCheck size={12} className="text-emerald-500" />
                  <span>Dado auditado no Banco Invictus • Origem Verificada</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
