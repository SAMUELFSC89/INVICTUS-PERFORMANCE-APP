import { Capacitor } from '@capacitor/core';

// #242: "quero fornecer retorno por gesto se possivel" -- feedback tatil
// (vibracao) para gestos/toques importantes do app. So funciona em
// iOS/Android nativos (Capacitor); no navegador vira no-op silencioso (sem
// tentar Vibration API do browser, que tem suporte inconsistente e nao
// pedimos permissao pra isso). Import dinamico evita custo de bundle extra
// no build web quando o modulo nao e usado.
//
// Uso pontual e proposital: gestos/acoes de destaque que o usuario realmente
// SENTE como um passo concluido (fim de serie, fim de descanso, conquista
// desbloqueada, inicio/fim de atividade) -- nao em todo botao do app, que
// tornaria a vibracao cansativa em vez de util.
type ImpactStyle = 'light' | 'medium' | 'heavy';
type NotificationStyle = 'success' | 'warning' | 'error';

async function loadHaptics() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await import('@capacitor/haptics');
  } catch (error) {
    console.warn('[haptics] Plugin indisponivel (build nativo sem @capacitor/haptics sincronizado):', error);
    return null;
  }
}

export async function hapticImpact(style: ImpactStyle = 'medium'): Promise<void> {
  const mod = await loadHaptics();
  if (!mod) return;
  try {
    const styleMap = { light: mod.ImpactStyle.Light, medium: mod.ImpactStyle.Medium, heavy: mod.ImpactStyle.Heavy };
    await mod.Haptics.impact({ style: styleMap[style] });
  } catch (error) {
    console.warn('[haptics] impact falhou (nao critico):', error);
  }
}

export async function hapticNotification(style: NotificationStyle = 'success'): Promise<void> {
  const mod = await loadHaptics();
  if (!mod) return;
  try {
    const styleMap = { success: mod.NotificationType.Success, warning: mod.NotificationType.Warning, error: mod.NotificationType.Error };
    await mod.Haptics.notification({ type: styleMap[style] });
  } catch (error) {
    console.warn('[haptics] notification falhou (nao critico):', error);
  }
}

export async function hapticSelection(): Promise<void> {
  const mod = await loadHaptics();
  if (!mod) return;
  try {
    await mod.Haptics.selectionStart();
    await mod.Haptics.selectionChanged();
    await mod.Haptics.selectionEnd();
  } catch (error) {
    console.warn('[haptics] selection falhou (nao critico):', error);
  }
}
