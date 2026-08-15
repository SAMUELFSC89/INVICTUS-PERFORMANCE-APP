import React, { useMemo, useState } from 'react';
import { ArrowLeft, FlaskConical, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { calculateWeeklyIGAOriginal, IGAOriginalSessionInput } from '../core/iga/igaOriginal';

interface EditableSession {
  id: string;
  durationMinutes: number;
  caloriesInformed: number;
  avgHeartRate: number;
}

let nextId = 1;
function newSession(durationMinutes: number, caloriesInformed: number, avgHeartRate: number): EditableSession {
  const id = 'session-' + (nextId++);
  return { id, durationMinutes, caloriesInformed, avgHeartRate };
}

export function AdminIGATesteOriginal() {
  const navigate = useNavigate();
  const [age, setAge] = useState(30);
  const [sessions, setSessions] = useState<EditableSession[]>([
    newSession(50, 420, 150),
    newSession(45, 380, 145),
    newSession(60, 500, 155)
  ]);

  const updateSession = (id: string, field: keyof EditableSession, value: number) => {
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const removeSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  const addSession = () => {
    setSessions(prev => [...prev, newSession(45, 350, 140)]);
  };

  const result = useMemo(() => {
    const input: IGAOriginalSessionInput[] = sessions.map(s => ({
      id: s.id,
      durationMinutes: s.durationMinutes,
      caloriesInformed: s.caloriesInformed,
      avgHeartRate: s.avgHeartRate
    }));
    return calculateWeeklyIGAOriginal(input, { age });
  }, [sessions, age]);

  return (
    <div className='min-h-screen bg-background pb-24'>
      <header className='px-6 pt-12 pb-8 space-y-4'>
        <button
          onClick={() => navigate('/admin')}
          className='flex items-center gap-2 text-on-surface-variant hover:text-white transition-colors text-xs font-black uppercase tracking-wider cursor-pointer'
        >
          <ArrowLeft size={14} />
          Voltar ao Painel Admin
        </button>

        <div className='flex items-center gap-3'>
          <FlaskConical className='text-amber-400' size={24} />
          <h1 className='font-headline italic font-black text-3xl text-on-surface uppercase tracking-tight'>
            IGA ORIGINAL — TESTE
          </h1>
        </div>
        <p className='font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest leading-none'>
          Formula literal do documento oficial - versao isolada, so para demonstracao aos socios
        </p>
      </header>

      <div className='px-6 space-y-6'>
        <section className='bg-amber-500/10 border border-amber-500/30 p-6 rounded-[32px] space-y-3'>
          <div className='flex items-center gap-3'>
            <AlertTriangle className='text-amber-400 shrink-0' size={22} />
            <h3 className='font-headline italic font-black text-sm text-amber-300 uppercase tracking-tight'>
              Ferramenta de teste interno - nao afeta pontuacao real
            </h3>
          </div>
          <p className='text-xs text-amber-100/80 font-medium leading-relaxed'>
            Esta tela calcula o IGA e o ICV EXATAMENTE como descritos no documento
            "Invictus Performance - Metodologia Cientifica Oficial" (Secao 10.5 e 10.6),
            sem nenhum dos ajustes negociados depois (sem calorias relativas ao peso,
            sem gate gradual de antifraude, sem handicap de idade). Nao altera o ranking
            nem a pontuacao de nenhum usuario real - serve apenas para os socios verem
            como a formula original se comporta com numeros de exemplo. A versao corrigida
            sera apresentada separadamente.
          </p>
        </section>

        <section className='bg-surface-container-low p-6 sm:p-8 rounded-[40px] border border-outline-variant/15 space-y-4'>
          <h3 className='font-headline italic font-black text-lg text-on-surface uppercase tracking-tight'>
            Formula (Secao 10.5 / 10.6 do documento)
          </h3>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <div className='bg-black/30 p-5 rounded-3xl border border-white/5'>
              <p className='text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest mb-1'>IGA</p>
              <p className='font-mono text-sm text-primary'>IGA = (F x C x T x I) ^ (1/4)</p>
            </div>
            <div className='bg-black/30 p-5 rounded-3xl border border-white/5'>
              <p className='text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest mb-1'>ICV</p>
              <p className='font-mono text-sm text-secondary'>ICV = raiz(I x T)</p>
            </div>
          </div>
          <p className='text-[10px] text-on-surface-variant font-medium leading-relaxed opacity-70'>
            F = numero de sessoes na semana | C = calorias totais informadas (kcal) |
            T = minutos totais de exercicio | I = intensidade relativa media (% da FC maxima)
          </p>
        </section>

        <section className='bg-surface-container-low p-6 sm:p-8 rounded-[40px] border border-outline-variant/15 space-y-6'>
          <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-4'>
            <h3 className='font-headline italic font-black text-lg text-on-surface uppercase tracking-tight'>
              Sessoes da semana (simulacao)
            </h3>
            <div className='flex items-center gap-3'>
              <label className='text-[9px] font-black text-on-surface-variant uppercase tracking-widest'>Idade do atleta</label>
              <input
                type='number'
                value={age}
                onChange={(e) => setAge(Number(e.target.value) || 0)}
                className='w-20 bg-surface-container-high border border-outline-variant/10 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-primary/40'
              />
            </div>
          </div>

          <div className='space-y-3'>
            {sessions.map((s, i) => (
              <div key={s.id} className='bg-black/20 p-4 rounded-2xl border border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end'>
                <div>
                  <label className='text-[8px] font-black text-on-surface-variant uppercase tracking-widest'>Sessao {i + 1} - min</label>
                  <input
                    type='number'
                    value={s.durationMinutes}
                    onChange={(e) => updateSession(s.id, 'durationMinutes', Number(e.target.value) || 0)}
                    className='w-full bg-surface-container-high border border-outline-variant/10 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-primary/40 mt-1'
                  />
                </div>
                <div>
                  <label className='text-[8px] font-black text-on-surface-variant uppercase tracking-widest'>Kcal</label>
                  <input
                    type='number'
                    value={s.caloriesInformed}
                    onChange={(e) => updateSession(s.id, 'caloriesInformed', Number(e.target.value) || 0)}
                    className='w-full bg-surface-container-high border border-outline-variant/10 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-primary/40 mt-1'
                  />
                </div>
                <div>
                  <label className='text-[8px] font-black text-on-surface-variant uppercase tracking-widest'>FC media (bpm)</label>
                  <input
                    type='number'
                    value={s.avgHeartRate}
                    onChange={(e) => updateSession(s.id, 'avgHeartRate', Number(e.target.value) || 0)}
                    className='w-full bg-surface-container-high border border-outline-variant/10 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-primary/40 mt-1'
                  />
                </div>
                <button
                  onClick={() => removeSession(s.id)}
                  className='flex items-center justify-center gap-2 p-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all text-[10px] font-black uppercase'
                >
                  <Trash2 size={14} />
                  Remover
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addSession}
            className='flex items-center gap-2 px-5 py-3 bg-primary/10 border border-primary/30 hover:bg-primary/20 text-primary font-headline italic font-black text-xs uppercase tracking-wider rounded-full transition-colors cursor-pointer'
          >
            <Plus size={14} />
            Adicionar sessao
          </button>
        </section>

        <section className='bg-gradient-to-r from-primary/15 via-secondary/5 to-tertiary/15 p-8 rounded-[40px] border border-outline-variant/10 space-y-6'>
          <h3 className='font-headline italic font-black text-xl text-on-surface uppercase tracking-tight'>Resultado (formula original)</h3>
          <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
            <div className='bg-black/30 p-5 rounded-3xl border border-white/5 space-y-1'>
              <p className='text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest'>F</p>
              <p className='font-headline italic font-black text-2xl text-on-surface'>{result.F}</p>
              <p className='text-[8px] text-on-surface-variant uppercase'>sessoes</p>
            </div>
            <div className='bg-black/30 p-5 rounded-3xl border border-white/5 space-y-1'>
              <p className='text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest'>C</p>
              <p className='font-headline italic font-black text-2xl text-on-surface'>{result.C}</p>
              <p className='text-[8px] text-on-surface-variant uppercase'>kcal</p>
            </div>
            <div className='bg-black/30 p-5 rounded-3xl border border-white/5 space-y-1'>
              <p className='text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest'>T</p>
              <p className='font-headline italic font-black text-2xl text-on-surface'>{result.T}</p>
              <p className='text-[8px] text-on-surface-variant uppercase'>minutos</p>
            </div>
            <div className='bg-black/30 p-5 rounded-3xl border border-white/5 space-y-1'>
              <p className='text-[9px] font-mono font-black text-on-surface-variant uppercase tracking-widest'>I</p>
              <p className='font-headline italic font-black text-2xl text-on-surface'>{result.I}%</p>
              <p className='text-[8px] text-on-surface-variant uppercase'>FC maxima</p>
            </div>
          </div>

          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <div className='bg-black/40 p-6 rounded-3xl border border-primary/20 text-center'>
              <p className='text-[10px] font-mono font-black text-primary uppercase tracking-widest mb-2'>IGA (original)</p>
              <p className='font-headline italic font-black text-4xl text-primary'>{result.iga}</p>
            </div>
            <div className='bg-black/40 p-6 rounded-3xl border border-secondary/20 text-center'>
              <p className='text-[10px] font-mono font-black text-secondary uppercase tracking-widest mb-2'>ICV (original)</p>
              <p className='font-headline italic font-black text-4xl text-secondary'>{result.icv}</p>
            </div>
          </div>

          <div className='bg-black/20 p-4 rounded-2xl border border-white/5'>
            <p className='font-mono text-[10px] text-on-surface-variant leading-relaxed break-words'>{result.auditSummary}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
