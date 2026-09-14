import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../_lib/common.js';
import Jimp from 'jimp';
import { resolveActivityState } from '../../src/lib/workoutData.js';
import { resolveActivityShareGrant } from '../_lib/share-access.js';
import { trustedShareImageUrl } from '../_lib/share-image-policy.js';
import { isActiveAccountState } from '../_lib/account-state.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

function dataImageBuffer(value: unknown): Buffer | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  if (match[1].length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16) return null;
  try {
    const buffer = Buffer.from(match[1], 'base64');
    return buffer.length > 0 && buffer.length <= MAX_IMAGE_BYTES ? buffer : null;
  } catch {
    return null;
  }
}

async function trustedRemoteImageBuffer(value: unknown): Promise<Buffer | null> {
  const url = trustedShareImageUrl(value);
  if (!url) return null;

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'image/*' },
    });
    if (!response.ok) return null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return Buffer.from(bytes);
  } catch (error: any) {
    console.warn('[ShareImage] Imagem remota recusada ou indisponível:', error?.message || error);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawToken = req.query.id;
  if (typeof rawToken !== 'string') return res.status(400).send('Invalid share');

  try {
    const grant = await resolveActivityShareGrant(rawToken);
    if (!grant) return res.status(404).send('Share not found');

    const sourceDoc = await db.collection(grant.source).doc(grant.activityId).get();
    if (!sourceDoc.exists) return res.status(404).send('No data');
    const sourceData: any = sourceDoc.data() || {};
    if (sourceData.userId !== grant.userId) return res.status(404).send('No data');
    const workout: any = grant.source === 'run_sessions' ? runSessionAsWorkout(sourceData) : sourceData;

    const userDoc = await db.collection('users').doc(grant.userId).get();
    if (!userDoc.exists || !isActiveAccountState(userDoc.data())) return res.status(404).send('Share unavailable');
    const user: any = userDoc.data() || { displayName: 'Atleta' };

    const width = 1200;
    const height = 630;
    const image = new Jimp(width, height, '#0c0d10');

    if (workout.photoUrl) {
      try {
        const bgBuffer = dataImageBuffer(workout.photoUrl) || await trustedRemoteImageBuffer(workout.photoUrl);
        if (bgBuffer) {
          const bgImage = await Jimp.read(bgBuffer);
          bgImage.cover(width, height);
          bgImage.blur(2);
          image.composite(bgImage, 0, 0);
        }
      } catch (err) {
        console.warn('[ShareImage] Falha ao renderizar foto autorizada:', err);
      }
    }

    const overlay = new Jimp(width, height, '#000000');
    overlay.opacity(0.6);
    image.composite(overlay, 0, 0);

    const fontTitle = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
    const fontLabel = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const fontXP = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

    const displayName = typeof user.displayName === 'string' && user.displayName.trim() ? user.displayName.trim() : 'Atleta';
    const handle = displayName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9_.-]/g, '').slice(0, 40) || 'atleta';
    image.print(fontTitle, 60, 60, 'INVICTUS');
    image.print(fontLabel, 60, 130, `@${handle}`);

    const activityState = resolveActivityState(workout);
    const points = Number.isFinite(Number(workout.activityXpAwarded ?? workout.points)) ? Number(workout.activityXpAwarded ?? workout.points) : 0;
    const xpText = points > 0 ? `+${points} XP` : activityState.isCompleted ? 'CONCLUIDA' : 'ATIVIDADE';
    const xpBg = new Jimp(220, 60, '#00E676');
    image.composite(xpBg, 60, height - 120);
    image.print(fontXP, 80, height - 110, xpText);

    const typeLabel = (workout.type === 'workout' ? 'TREINO'
      : workout.type === 'cardio' ? 'CARDIO'
        : workout.type === 'diet' ? 'DIETA' : 'ATIVIDADE').toUpperCase();
    image.print(fontLabel, 320, height - 110, typeLabel);

    if (Number(workout.distance) > 0) {
      image.print(fontLabel, 620, height - 110, `${Number(workout.distance).toFixed(2)} KM`);
    } else if (Number.isFinite(Number(workout.duration))) {
      image.print(fontLabel, 620, height - 110, `${Number(workout.duration)} MIN`);
    }

    image.print(fontLabel, width - 300, height - 60, 'INVICTUS.APP');
    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buffer);
  } catch (error: any) {
    console.error('Image Generation Error:', error);
    return res.status(500).send('Internal Error');
  }
}
