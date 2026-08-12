import { UserProfile } from '../types';
import { API_CONFIG } from '../config';

export const whatsappService = {
  async sendNotification(user: UserProfile, type: string, message: string) {
    if (!user.whatsappEnabled || !user.phoneNumber) return;

    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, message, type })
      });
      return await response.json();
    } catch (error) {
      console.error('[WhatsApp] Failed to send notification:', error);
    }
  },

  async checkTriggers(user: UserProfile) {
    const now = new Date();
    const hour = now.getHours();

    // 1. Lembrete de Treino (10h - 12h)
    if (hour >= 10 && hour <= 12 && !this.hasTrainedToday(user)) {
      await this.sendNotification(user, 'reminder', `${user.displayName}, você ainda não treinou hoje! Bora manter o foco?`);
    }

    // 2. Alerta de Risco (Caindo no ranking)
    // This would be triggered by the backend ranking recalculation in a real app

    // 3. Streak (Sequência)
    if (user.streak > 0 && user.streak % 7 === 0) {
      await this.sendNotification(user, 'streak', `Parabéns ${user.displayName}! Você completou ${user.streak} dias seguidos! Continue assim!`);
    }

    // 4. Final do Dia (18h - 20h)
    if (hour >= 18 && hour <= 20 && !this.hasTrainedToday(user)) {
      await this.sendNotification(user, 'urgency', `Última chance do dia, ${user.displayName}! Não quebre sua sequência!`);
    }
  },

  hasTrainedToday(user: UserProfile) {
    if (!user.lastCheckIn) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastCheckIn = new Date(user.lastCheckIn);
    lastCheckIn.setHours(0, 0, 0, 0);
    return lastCheckIn.getTime() === today.getTime();
  }
};
