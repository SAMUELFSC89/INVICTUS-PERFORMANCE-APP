import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../_lib/common.js';
import { resolveActivityState } from '../../src/lib/workoutData.js';
import { resolveActivityShareGrant } from '../_lib/share-access.js';
import { isActiveAccountState } from '../_lib/account-state.js';
import { trustedShareImageUrl } from '../_lib/share-image-policy.js';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeImageUrl(value: unknown): string {
  const trusted = trustedShareImageUrl(value);
  return trusted ? escapeHtml(trusted.toString()) : '';
}

function runSessionAsWorkout(sessionData: any) {
  return {
    userId: sessionData.userId,
    type: 'cardio',
    timestamp: sessionData.createdAt?.toDate?.()?.toISOString() || sessionData.startTime,
    duration: sessionData.startTime && sessionData.endTime
      ? Math.floor((new Date(sessionData.endTime).getTime() - new Date(sessionData.startTime).getTime()) / 60000)
      : undefined,
    distance: Number.isFinite(Number(sessionData.totalDistance)) ? Number(sessionData.totalDistance) / 1000 : undefined,
    points: Number.isFinite(Number(sessionData.pointsEarned)) ? Number(sessionData.pointsEarned) : 0,
    status: sessionData.validationStatus,
    recordStatus: sessionData.recordStatus || (sessionData.endTime ? 'completed' : undefined),
    activityMode: sessionData.activityMode,
    competitionReviewStatus: sessionData.competitionReviewStatus,
    photoUrl: sessionData.photoProof || null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawToken = req.query.id || (req as any).params?.id;
  if (typeof rawToken !== 'string') return res.status(400).send('<h1>Compartilhamento inválido</h1>');

  try {
    const grant = await resolveActivityShareGrant(rawToken);
    if (!grant) return res.status(404).send('<h1>Compartilhamento não encontrado ou revogado</h1>');

    const sourceDoc = await db.collection(grant.source).doc(grant.activityId).get();
    if (!sourceDoc.exists) return res.status(404).send('<h1>Atividade não encontrada</h1>');
    const sourceData: any = sourceDoc.data() || {};
    if (sourceData.userId !== grant.userId) return res.status(404).send('<h1>Atividade não encontrada</h1>');
    const workout: any = grant.source === 'run_sessions' ? runSessionAsWorkout(sourceData) : sourceData;

    const userDoc = await db.collection('users').doc(grant.userId).get();
    if (!userDoc.exists || !isActiveAccountState(userDoc.data())) {
      return res.status(404).send('<h1>Compartilhamento indisponível</h1>');
    }
    const user: any = userDoc.data() || {};

    let rawAppUrl = process.env.APP_URL || process.env.VITE_APP_URL || `https://${req.headers.host}`;
    if (rawAppUrl.includes('sem-desculpa.vercel.app')) {
      rawAppUrl = rawAppUrl.replace('sem-desculpa.vercel.app', 'www.invictusperformance.app.br');
    }
    const appUrl = rawAppUrl.replace(/\/$/, '');
    const shareUrl = `${appUrl}/share/${encodeURIComponent(rawToken)}`;
    const imageUrl = `${appUrl}/api/share-image?id=${encodeURIComponent(rawToken)}`;

    const rawDisplayName = typeof user.displayName === 'string' && user.displayName.trim() ? user.displayName : 'Atleta';
    const displayName = escapeHtml(rawDisplayName);
    const handle = escapeHtml(rawDisplayName.toLowerCase().replace(/\s+/g, ''));
    const city = escapeHtml(user.city || 'Atleta Invictus');
    const safePhotoUrl = safeImageUrl(workout.photoUrl);
    const baseUrl = appUrl;

    const typeLabel = workout.type === 'workout' ? 'Treino 🔥'
      : workout.type === 'cardio' ? 'Cardio 🏃'
        : workout.type === 'diet' ? 'Dieta 🥗' : 'Atividade';
    const details = [
      Number.isFinite(Number(workout.distance)) ? `${Number(workout.distance).toFixed(2)} km` : null,
      Number.isFinite(Number(workout.duration)) ? `${Number(workout.duration)} min` : null,
    ].filter(Boolean).join(' em ');

    const activityState = resolveActivityState(workout);
    const points = Number.isFinite(Number(workout.activityXpAwarded ?? workout.points)) ? Number(workout.activityXpAwarded ?? workout.points) : 0;
    const competitionPoints = Number.isFinite(Number(workout.competitionPoints ?? workout.rankingPointsEarned)) ? Number(workout.competitionPoints ?? workout.rankingPointsEarned) : 0;
    const title = `${displayName} concluiu um ${typeLabel}!`;
    const xpText = points > 0 ? ` Ganhou +${points} XP.` : '';
    const resultText = activityState.competitionStatus === 'approved'
      ? `Atividade concluída com pontuação competitiva validada${competitionPoints > 0 ? `: +${competitionPoints} pontos` : ''}.${xpText}`
      : activityState.competitionStatus === 'pending' || activityState.competitionStatus === 'resolution_pending'
        ? `Atividade concluída.${xpText} Apenas a pontuação competitiva está em análise.`
        : activityState.competitionStatus === 'rejected' || activityState.competitionStatus === 'ineligible'
          ? `Atividade concluída.${xpText} O resultado ficou fora da pontuação competitiva.`
          : `Atividade concluída e salva no histórico.${xpText}`;
    const description = `Atividade no INVICTUS. ${resultText}${details ? ` ${details}.` : ''}`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta property="og:type" content="website">
  <meta property="og:url" content="${shareUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${shareUrl}">
  <meta property="twitter:title" content="${title}">
  <meta property="twitter:description" content="${escapeHtml(description)}">
  <meta property="twitter:image" content="${imageUrl}">
  <link rel="icon" href="${baseUrl}/favicon-32.png" type="image/png">
  <style>
    body{margin:0;background:#0c0d10;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{max-width:480px;width:90%;background:#16181d;border:1px solid rgba(255,255,255,.08);border-radius:28px;overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.8)}
    .header,.stats,.footer{padding:24px}.header{text-align:center}.photo{height:260px;background:#1a1c23 center/cover no-repeat ${safePhotoUrl ? `url('${safePhotoUrl}')` : 'none'}}
    .row{display:flex;justify-content:space-between;gap:20px;margin:12px 0}.label{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:2px}.value{font-size:22px;font-weight:700}.xp{display:inline-block;background:#00E676;color:#000;padding:7px 14px;border-radius:20px;font-weight:800}.footer{text-align:center}.btn{display:block;background:#00E676;color:#000;padding:16px;border-radius:14px;text-decoration:none;font-weight:800}.muted{color:#8b949e;font-size:13px}
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><strong>INVICTUS</strong><div class="muted">@${handle}</div></div>
    <div class="photo"></div>
    <div class="stats">
      <div class="row"><div><div class="label">Atividade</div><div class="value">${typeLabel}</div></div><div><span class="xp">${points > 0 ? `+${points} XP` : 'CONCLUÍDA'}</span></div></div>
      <div class="row"><div><div class="label">Duração</div><div class="value">${Number.isFinite(Number(workout.duration)) ? `${Number(workout.duration)} min` : '—'}</div></div>${Number.isFinite(Number(workout.distance)) && Number(workout.distance) > 0 ? `<div><div class="label">Distância</div><div class="value">${Number(workout.distance).toFixed(2)} km</div></div>` : `<div><div class="label">Cidade</div><div class="value">${city}</div></div>`}</div>
    </div>
    <div class="footer"><a href="${baseUrl}" class="btn">CONHECER O INVICTUS</a></div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.status(200).send(html);
  } catch (error) {
    console.error('Share API Error:', error);
    return res.status(500).send('<h1>Erro interno no compartilhamento</h1>');
  }
}
