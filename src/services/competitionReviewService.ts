import { auth } from '../firebase';
import { API_CONFIG } from '../config';

export type CompetitionReviewCategory = 'activity' | 'heart_rate' | 'discarded_samples' | 'validation' | 'score' | 'ranking' | 'technical_failure';

export async function requestCompetitionReview(input: {
  source: 'workout' | 'checkin' | 'power';
  subjectId: string;
  category: CompetitionReviewCategory;
  reason: string;
}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre novamente para enviar a contestação.');
  const token = await user.getIdToken();
  const response = await fetch(`${API_CONFIG.baseUrl}/api/competition-review`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível registrar a contestação.');
  return payload as { requestId: string; status: 'submitted'; message: string };
}
