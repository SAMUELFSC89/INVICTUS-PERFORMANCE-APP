import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Clock3, Moon, RotateCcw, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { healthSummaryService } from '../services/healthSummaryService';
import './SleepCheckin.css';

type SleepCheckinRecord = {
  localDate: string;
  timeZone: string;
  bedtime: string;
  wakeTime: string;
  sleepLatencyMinutes: number;
  awakenings: number;
  quality: number;
  restedness: number;
  sleepDurationMinutes: number;
  updatedAt: string;
};

const todayLocalDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function localDateParts(localDate: string) {
  const [year, month, day] = localDate.split('-').map(Number);
  return { year, month, day };
}

export function buildManualSleepWindow(localDate: string, bedtime: string, wakeTime: string) {
  const { year, month, day } = localDateParts(localDate);
  const [bedHour, bedMinute] = bedtime.split(':').map(Number);
  const [wakeHour, wakeMinute] = wakeTime.split(':').map(Number);
  const end = new Date(year, month - 1, day, wakeHour, wakeMinute, 0, 0);
  const start = new Date(year, month - 1, day, bedHour, bedMinute, 0, 0);
  if (start.getTime() >= end.getTime()) start.setDate(start.getDate() - 1);
  return { sleepStart: start.toISOString(), sleepEnd: end.toISOString() };
}

function Scale({ value, onChange, low, high }: { value: number; onChange: (value: number) => void; low: string; high: string }) {
  return <div className="sleep-scale-wrap">
    <div className="sleep-scale" role="group">
      {[1, 2, 3, 4, 5].map(number => <button key={number} type="button" className={value === number ? 'is-active' : ''} onClick={() => onChange(number)}>{number}</button>)}
    </div>
    <div className="sleep-scale-labels"><span>{low}</span><span>{high}</span></div>
  </div>;
}

export function SleepCheckin() {
  const navigate = useNavigate();
  const [localDate, setLocalDate] = useState(todayLocalDate());
  const [bedtime, setBedtime] = useState('23:00');
  const [wakeTime, setWakeTime] = useState('07:00');
  const [latency, setLatency] = useState(15);
  const [awakenings, setAwakenings] = useState(0);
  const [quality, setQuality] = useState(3);
  const [restedness, setRestedness] = useState(3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const estimatedMinutes = useMemo(() => {
    try {
      const window = buildManualSleepWindow(localDate, bedtime, wakeTime);
      return Math.max(0, Math.round((Date.parse(window.sleepEnd) - Date.parse(window.sleepStart)) / 60000) - latency);
    } catch { return 0; }
  }, [localDate, bedtime, wakeTime, latency]);

  useEffect(() => {
    let active = true;
    setLoading(true); setSaved(false); setError(null);
    void (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const base = API_CONFIG.baseUrl || '';
        const response = await fetch(`${base}/api/health-summary?action=sleep-checkin&date=${encodeURIComponent(localDate)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const payload = await response.json();
        const checkin = payload?.checkin as SleepCheckinRecord | null;
        if (!active || !checkin) return;
        setBedtime(checkin.bedtime); setWakeTime(checkin.wakeTime);
        setLatency(checkin.sleepLatencyMinutes); setAwakenings(checkin.awakenings);
        setQuality(checkin.quality); setRestedness(checkin.restedness);
      } catch {
        if (active) setError('Não foi possível carregar o registro desta noite. Você ainda pode preenchê-lo novamente.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [localDate]);

  const save = async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Faça login novamente para registrar seu sono.');
      const token = await user.getIdToken();
      const window = buildManualSleepWindow(localDate, bedtime, wakeTime);
      const base = API_CONFIG.baseUrl || '';
      const response = await fetch(`${base}/api/health-summary?action=sleep-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'sleep-checkin', localDate, timeZone, bedtime, wakeTime,
          sleepLatencyMinutes: latency, awakenings, quality, restedness,
          ...window,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível salvar seu sono.');
      healthSummaryService.invalidate();
      setSaved(true);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar seu sono.');
    } finally { setSaving(false); }
  };

  const durationLabel = estimatedMinutes > 0
    ? `${Math.floor(estimatedMinutes / 60)}h ${String(estimatedMinutes % 60).padStart(2, '0')}m estimados`
    : 'Confira os horários';

  return <main className="sleep-checkin-page">
    <header className="sleep-checkin-header">
      <button type="button" onClick={() => navigate('/health')} aria-label="Voltar para Saúde"><ArrowLeft /></button>
      <div><span>AUTO-RELATO</span><h1>COMO FOI SEU SONO?</h1></div>
      <Moon aria-hidden="true" />
    </header>

    <section className="sleep-intro">
      <div className="sleep-moon"><Moon /></div>
      <div><strong>Sem relógio? Tudo bem.</strong><p>Responda sobre a última noite. O Invictus usa este registro como auto-relato e nunca como medição de sensor.</p></div>
    </section>

    <section className="sleep-form-card" aria-busy={loading || saving}>
      <label className="sleep-field"><span>Dia em que você acordou</span><input type="date" value={localDate} max={todayLocalDate()} onChange={event => setLocalDate(event.target.value)} /></label>
      <div className="sleep-two-cols">
        <label className="sleep-field"><span>Que horas você deitou?</span><div className="sleep-input-icon"><Clock3 /><input type="time" value={bedtime} onChange={event => setBedtime(event.target.value)} /></div></label>
        <label className="sleep-field"><span>Que horas você acordou?</span><div className="sleep-input-icon"><Clock3 /><input type="time" value={wakeTime} onChange={event => setWakeTime(event.target.value)} /></div></label>
      </div>

      <label className="sleep-field"><span>Quanto tempo levou para adormecer?</span><select value={latency} onChange={event => setLatency(Number(event.target.value))}><option value={0}>Quase imediatamente</option><option value={5}>Até 5 min</option><option value={15}>5–15 min</option><option value={30}>15–30 min</option><option value={45}>30–45 min</option><option value={60}>45–60 min</option><option value={90}>1h–1h30</option><option value={120}>Mais de 1h30</option></select></label>

      <label className="sleep-field"><span>Quantas vezes você lembra de ter acordado?</span><select value={awakenings} onChange={event => setAwakenings(Number(event.target.value))}>{[0,1,2,3,4,5,6,7,8,9,10].map(number => <option key={number} value={number}>{number === 0 ? 'Nenhuma' : number >= 10 ? '10 ou mais' : number}</option>)}</select></label>

      <div className="sleep-question"><span>Como você avalia a qualidade do seu sono?</span><Scale value={quality} onChange={setQuality} low="Muito ruim" high="Excelente" /></div>
      <div className="sleep-question"><span>Como você acordou?</span><Scale value={restedness} onChange={setRestedness} low="Exausto" high="Muito descansado" /></div>

      <div className="sleep-estimate"><Moon /><div><small>DURAÇÃO ESTIMADA</small><strong>{durationLabel}</strong></div></div>
      {error && <p className="sleep-error">{error}</p>}
      {saved && <p className="sleep-success"><Check /> Sono registrado. A Saúde já pode usar este auto-relato.</p>}

      <button className="sleep-save" type="button" onClick={save} disabled={saving || loading}>{saving ? <><RotateCcw className="is-spinning" /> SALVANDO…</> : <><Check /> SALVAR MINHA NOITE</>}</button>
    </section>

    <footer className="sleep-disclaimer"><ShieldCheck /><p><strong>Auto-relato, não medição.</strong> Se houver sono do Apple Health ou Health Connect para a mesma noite, o Invictus prioriza o dado do dispositivo. Este registro não entra no IGA nem no ranking.</p></footer>
  </main>;
}
