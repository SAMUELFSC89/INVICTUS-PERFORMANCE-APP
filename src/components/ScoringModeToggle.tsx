import { Trophy } from 'lucide-react';

/**
 * Controle de "pontuação ativa/desativada" reutilizado entre Musculação e
 * Cardio (corrida/caminhada). Extraído de Musculation.tsx para que os dois
 * fluxos usem exatamente o mesmo componente -- ver personalWorkoutPolicyService
 * / api/_handlers/activity-policy.ts para a autorização real no servidor,
 * que é quem de fato decide se a atividade pode virar pessoal.
 */
export function ScoringModeToggle({
  enabled,
  onChange,
  disabled = false,
  onLabel,
  offLabel,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return <article className="mus-plan-lock-note" style={{ alignItems: 'center', margin: '0 0 12px', padding: '12px 14px' }}>
    <Trophy size={18} />
    <span style={{ display: 'grid', gap: 2, flex: 1 }}>
      <b style={{ color: enabled ? '#f5b514' : '#f3f3f3', fontSize: 13 }}>PONTUAÇÃO {enabled ? 'ATIVADA' : 'DESATIVADA'}</b>
      <small style={{ color: '#aaa', lineHeight: 1.35 }}>
        {enabled
          ? (onLabel || 'Se este treino for elegível para ranking/campeonato, o check-in competitivo será exigido.')
          : (offLabel || 'Treino pessoal: salva cargas, volume, histórico e saúde, mas não entra em ranking ou campeonato.')}
      </small>
    </span>
    <button
      type="button"
      aria-label={enabled ? 'Desativar pontuação nesta atividade' : 'Ativar pontuação nesta atividade'}
      aria-pressed={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      style={{
        position: 'relative', flex: '0 0 auto', width: 48, height: 28, border: 0, borderRadius: 20,
        background: enabled ? '#f5b514' : '#2c2c2c', opacity: disabled ? .55 : 1, cursor: disabled ? 'default' : 'pointer'
      }}
    >
      <span style={{ position: 'absolute', top: 4, left: enabled ? 24 : 4, width: 20, height: 20, borderRadius: '50%', background: enabled ? '#171107' : '#e7e7e7', transition: 'left .18s ease' }} />
    </button>
  </article>;
}
