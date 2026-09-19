import { createHash } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { cors, db, app, verifyAuth } from '../_lib/common.js';
import { isProUser } from '../_lib/entitlement.js';
import { resolvePowerLiftAuditStatus } from '../_lib/powerlift-audit.js';
import {
  powerLiftDateKey,
  resolvePowerLiftSeason,
  scoredPowerLiftSets,
  type PowerLiftExercise,
  type PowerLiftSetInput,
  type PowerLiftSex,
} from '../../src/core/powerLift/season.js';
import {
  applyApprovedPowerLiftRecord,
  getPowerLiftEliteRanking,
  getPowerLiftGeneralRanking,
  getPowerLiftSeasonStatus,
  publicPowerLiftEntry,
  setPowerLiftRankingOptIn,
} from '../_lib/powerlift-season-engine.js';

const EXERCISES = new Set<PowerLiftExercise>(['supino', 'agachamento', 'terra']);
const MAX_RANKING_RESULTS = 100;
const MAX_MY_RECORDS = 100;

type Exercise = PowerLiftExercise;
type Decision = 'approved' | 'manual_review' | 'rejected';

type StoredValidation = {
  userId: string;
  exercise: Exercise;
  weight: number;
  decision: Decision;
  confidence: number;
  analysis: string;
  motives: string[];
  estimatedWeight?: number;
  expiresAt: string;
  consumedAt?: string;
  recordId?: string;
};

function safeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function parseExercise(value: unknown): Exercise | null {
  const exercise = safeText(value, 32) as Exercise;
  return EXERCISES.has(exercise) ? exercise : null;
}

function parseWeight(value: unknown): number | null {
  const weight = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(weight) && weight >= 2.5 && weight <= 1000 ? weight : null;
}

function parseSeries(value: unknown, fallbackWeight: number): PowerLiftSetInput[] | null {
  if (value === undefined || value === null) return [{ weight: fallbackWeight, reps: 1 }];
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;

  const series: PowerLiftSetInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const weight = parseWeight((raw as any).weight);
    const rawReps = Math.floor(Number((raw as any).reps));
    if (weight === null || !Number.isFinite(rawReps) || rawReps < 1 || rawReps > 100) return null;
    series.push({ weight, reps: rawReps });
  }
  return series;
}

function parseCompetitionSex(value: unknown): PowerLiftSex | null {
  return value === 'male' || value === 'female' ? value : null;
}

function safeMotives(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 10);
}

function storagePathFromDownloadUrl(videoUrl: string, expectedBucket: string): string | null {
  let url: URL;
  try {
    url = new URL(videoUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  let bucket = '';
  let objectPath = '';
  if (url.hostname === 'firebasestorage.googleapis.com') {
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match) return null;
    bucket = decodeURIComponent(match[1]);
    objectPath = decodeURIComponent(match[2]);
  } else if (url.hostname === 'storage.googleapis.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    bucket = decodeURIComponent(segments.shift()!);
    objectPath = segments.map((segment) => decodeURIComponent(segment)).join('/');
  } else {
    return null;
  }

  if (bucket !== expectedBucket || !objectPath || objectPath.length > 512) return null;
  if (objectPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return objectPath;
}

async function verifyOwnedVideo(videoUrl: string, userId: string): Promise<{ path: string; contentType: string; size: number }> {
  const bucket = getStorage(app).bucket();
  if (!bucket.name) throw new Error('O bucket de vídeo não está configurado.');

  const objectPath = storagePathFromDownloadUrl(videoUrl, bucket.name);
  const prefix = `power_records/${userId}/`;
  if (!objectPath || !objectPath.startsWith(prefix) || objectPath.length <= prefix.length || objectPath.slice(prefix.length).includes('/')) {
    throw new Error('O vídeo precisa pertencer ao diretório seguro do atleta.');
  }

  const file = bucket.file(objectPath);
  const [exists] = await file.exists();
  if (!exists) throw new Error('O vídeo informado não foi encontrado no armazenamento seguro.');

  const [metadata] = await file.getMetadata();
  const contentType = String(metadata.contentType || '').toLowerCase();
  const size = Number(metadata.size || 0);
  if (!contentType.startsWith('video/') || !Number.isFinite(size) || size <= 0 || size > 100 * 1024 * 1024) {
    throw new Error('O arquivo de vídeo não atende às regras de formato ou tamanho.');
  }
  return { path: objectPath, contentType, size };
}

function publicRecord(record: Record<string, any>, includeVideoUrl: boolean) {
  return {
    id: record.id,
    userId: record.userId,
    userName: record.userName || 'Atleta',
    userPhoto: record.userPhoto || '',
    gymId: record.gymId || '',
    gymName: record.gymName || '',
    exercise: record.exercise,
    weight: Number(record.weight) || 0,
    series: Array.isArray(record.series) ? record.series.slice(0, 3) : [],
    powerVolume: Number(record.powerVolume) || Number(record.weight) || 0,
    seasonId: record.seasonId || '',
    seasonNumber: Number(record.seasonNumber) || 0,
    seasonScore: Number(record.seasonScore) || 0,
    competitiveScore: Number(record.competitiveScore) || 0,
    seasonTier: record.seasonTier || 'UNRANKED',
    competitionSex: record.competitionSex || '',
    dateKey: record.dateKey || record.date || '',
    tierAdvancedTo: record.tierAdvancedTo || null,
    videoStatus: record.videoStatus,
    date: record.date || '',
    createdAt: record.createdAt || '',
    ...(includeVideoUrl ? { videoUrl: record.videoUrl || '', userMessage: record.userMessage || '', motives: record.motives || [] } : {})
  };
}

async function handleSubmit(req: any, res: any, userId: string) {
  const body = req.body || {};
  const exercise = parseExercise(body.exercise);
  const weight = parseWeight(body.weight);
  const videoUrl = safeText(body.videoUrl, 4096);
  const validationId = safeText(body.validationId, 128);

  if (!exercise || weight === null || !videoUrl) {
    return res.status(400).json({ error: 'Dados do levantamento inválidos.' });
  }
  if (validationId && !/^[A-Za-z0-9_-]{8,128}$/.test(validationId)) {
    return res.status(400).json({ error: 'Identificador de auditoria inválido.' });
  }

  const series = parseSeries(body.series, weight);
  if (!series) return res.status(400).json({ error: 'As séries do Power Lift são inválidas.' });
  const season = resolvePowerLiftSeason(new Date());
  if (body.seasonId && safeText(body.seasonId, 64) !== season.id) {
    return res.status(409).json({ error: 'A temporada mudou. Atualize o Power Lift antes de enviar a marca.' });
  }
  const dateKey = powerLiftDateKey(new Date());

  let video: { path: string; contentType: string; size: number };
  try {
    video = await verifyOwnedVideo(videoUrl, userId);
  } catch (error: any) {
    console.warn('[PowerLift] Vídeo recusado antes da criação:', error?.message || 'erro desconhecido');
    return res.status(400).json({ error: 'Não foi possível validar o vídeo enviado.' });
  }

  const recordId = `power_${createHash('sha256').update(video.path).digest('hex')}`;
  const dailySlotId = `powerday_${createHash('sha256').update(`${userId}|${season.id}|${exercise}|${dateKey}`).digest('hex')}`;
  const recordRef = db.collection('power_records').doc(recordId);
  const auditRef = db.collection('power_audit_logs').doc(`audit_${recordId}`);
  const dailySlotRef = db.collection('powerlift_daily_slots').doc(dailySlotId);
  const validationRef = validationId ? db.collection('power_validation_sessions').doc(validationId) : null;
  const now = new Date().toISOString();

  try {
    const result = await db.runTransaction(async (transaction: any) => {
      const reads: Promise<any>[] = [
        transaction.get(recordRef),
        transaction.get(db.collection('users').doc(userId)),
        transaction.get(dailySlotRef),
      ];
      if (validationRef) reads.push(transaction.get(validationRef));
      const [existingRecordSnap, profileSnap, slotSnap, validationSnap] = await Promise.all(reads);

      if (existingRecordSnap.exists) {
        const existing = existingRecordSnap.data() || {};
        if (existing.userId !== userId) throw new Error('Conflito de registro de vídeo.');
        return { record: { id: existingRecordSnap.id, ...existing }, idempotent: true };
      }
      if (!profileSnap.exists) throw new Error('Perfil do atleta não encontrado.');
      if (slotSnap.exists) throw new Error('Marca oficial diária já utilizada.');

      const profile = profileSnap.data() || {};
      const competitionSex = parseCompetitionSex(profile.sex);
      if (!competitionSex) throw new Error('Sexo biológico competitivo não informado.');
      const scoredSeries = scoredPowerLiftSets(series, exercise, competitionSex);
      const powerVolume = Math.round(scoredSeries.reduce((sum, set) => sum + set.volume, 0) * 100) / 100;
      if (!Number.isFinite(powerVolume) || powerVolume <= 0) throw new Error('Power Volume inválido para esta marca.');

      let effectiveDecision: Decision = 'manual_review';
      let confidence = 0;
      let analysis = 'Vídeo recebido e encaminhado para auditoria manual.';
      let motives = ['Aguardando auditoria técnica do vídeo completo.'];
      let estimatedWeight = weight;

      if (validationRef) {
        if (!validationSnap?.exists) throw new Error('A sessão de auditoria expirou ou não foi encontrada.');
        const validation = validationSnap.data() as StoredValidation;
        const expiresAt = new Date(String(validation.expiresAt || '')).getTime();
        if (validation.userId !== userId || validation.exercise !== exercise || Number(validation.weight) !== weight) {
          throw new Error('A sessão de auditoria não corresponde a este levantamento.');
        }
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          throw new Error('A sessão de auditoria expirou. Envie o vídeo novamente para validação.');
        }
        if (validation.recordId) {
          const previous = await transaction.get(db.collection('power_records').doc(validation.recordId));
          if (previous.exists && previous.data()?.userId === userId) {
            return { record: { id: previous.id, ...previous.data() }, idempotent: true };
          }
          throw new Error('A sessão de auditoria já foi utilizada.');
        }

        confidence = Math.max(0, Math.min(100, Number(validation.confidence) || 0));
        analysis = safeText(validation.analysis, 2000) || analysis;
        motives = safeMotives(validation.motives);
        estimatedWeight = parseWeight(validation.estimatedWeight) ?? weight;
        effectiveDecision = resolvePowerLiftAuditStatus(validation.decision, confidence);
      }

      const status = effectiveDecision === 'approved'
        ? 'approved'
        : effectiveDecision === 'rejected'
          ? 'rejected'
          : 'manual_review';

      const record = {
        id: recordId,
        userId,
        userName: safeText(profile.displayName || profile.name, 128) || 'Atleta',
        userPhoto: safeText(profile.photoURL, 2048),
        gymId: safeText(profile.gymId, 128),
        gymName: safeText(profile.gymName, 128),
        exercise,
        weight,
        series: scoredSeries,
        powerVolume,
        seasonId: season.id,
        seasonNumber: season.number,
        seasonStartsAt: season.startsAt,
        seasonEndsAt: season.endsAt,
        seasonScore: 0,
        competitiveScore: 0,
        seasonTier: 'UNRANKED',
        competitionSex,
        dateKey,
        dailySlotId,
        videoUrl,
        storagePath: video.path,
        videoContentType: video.contentType,
        videoSize: video.size,
        videoStatus: status,
        confidence,
        userMessage: analysis,
        motives,
        reports: [],
        date: dateKey,
        createdAt: now,
        updatedAt: now,
        ...(status === 'approved' ? { approvedAt: now, approvalSource: 'server_validation_session' } : {}),
        ...(status === 'rejected' ? { rejectedAt: now, rejectionReason: motives[0] || 'O vídeo não atendeu aos critérios de auditoria.' } : {})
      };
      const auditResult = status === 'approved' ? 'VALIDADO' : status === 'rejected' ? 'REPROVADO' : 'AUDITORIA_MANUAL';

      transaction.create(recordRef, record);
      if (status !== 'rejected') {
        transaction.create(dailySlotRef, {
          id: dailySlotId,
          userId,
          recordId,
          exercise,
          seasonId: season.id,
          dateKey,
          createdAt: now,
        });
      }
      transaction.create(auditRef, {
        id: auditRef.id,
        recordId,
        userId,
        userName: record.userName,
        exercise,
        declaredWeight: weight,
        powerVolume,
        series: scoredSeries,
        seasonId: season.id,
        competitionSex,
        declaredSexFromClient: parseCompetitionSex(body.competitionSex),
        estimatedWeight,
        confidence,
        result: auditResult,
        motivos: motives,
        analysis,
        videoUrl,
        storagePath: video.path,
        timestamp: now,
        aiVersion: 'Invictus Audit Server v3',
        scoringVersion: 'powerlift-season-v1',
        validationId: validationId || null
      });
      if (validationRef) transaction.update(validationRef, { consumedAt: now, recordId, effectiveDecision });

      return { record, idempotent: false };
    });

    let stored = result.record as Record<string, any>;
    if (stored.videoStatus === 'approved' && !stored.progressionAppliedAt) {
      try {
        await applyApprovedPowerLiftRecord(stored.id);
        const refreshed = await recordRef.get();
        if (refreshed.exists) stored = { id: refreshed.id, ...refreshed.data() };
      } catch (progressionError) {
        console.warn('[PowerLift] Marca aprovada aguardando conciliação de progressão:', progressionError);
      }
    }
    return res.status(result.idempotent ? 200 : 201).json({
      success: true,
      idempotent: result.idempotent,
      decision: stored.videoStatus,
      record: publicRecord(stored, true)
    });
  } catch (error: any) {
    console.error('[PowerLift] Falha ao persistir levantamento:', error?.message || error);
    const message = String(error?.message || '');
    const dailyUsed = /Marca oficial diária já utilizada/i.test(message);
    const profileSex = /Sexo biológico competitivo não informado/i.test(message);
    const volumeInvalid = /Power Volume inválido/i.test(message);
    const userError = dailyUsed || profileSex || volumeInvalid || /sessão de auditoria|Perfil do atleta|Conflito de registro|já foi utilizada|expirou|não corresponde/i.test(message);
    return res.status(userError ? 409 : 500).json({
      error: dailyUsed
        ? 'Você já utilizou a marca oficial de hoje nesta modalidade.'
        : profileSex
          ? 'Complete o campo Sexo Biológico no perfil antes de competir no Power Lift.'
          : volumeInvalid
            ? 'Nenhuma série atingiu os critérios mínimos do Power Volume.'
            : userError
              ? 'Não foi possível concluir este envio de vídeo. Faça uma nova validação e tente novamente.'
              : 'Não foi possível registrar o levantamento agora.'
    });
  }
}

async function handleRanking(req: any, res: any, userId: string) {
  const exerciseParam = req.query.exercise;
  const exercise = exerciseParam === undefined || exerciseParam === '' ? null : parseExercise(exerciseParam);
  if (exerciseParam && !exercise) return res.status(400).json({ error: 'Modalidade inválida.' });
  const requestedLimit = Math.floor(Number(req.query.limit) || 50);
  const take = Math.min(MAX_RANKING_RESULTS, Math.max(1, requestedLimit));

  try {
    if (exercise) {
      const ranking = await getPowerLiftEliteRanking(userId, exercise, take);
      return res.status(200).json({
        success: true,
        records: ranking.entries.map(publicPowerLiftEntry),
        rankingMode: 'exercise',
        season: ranking.season,
        competitionSex: ranking.competitionSex,
      });
    }

    const [supino, agachamento, terra, general] = await Promise.all([
      getPowerLiftEliteRanking(userId, 'supino', take),
      getPowerLiftEliteRanking(userId, 'agachamento', take),
      getPowerLiftEliteRanking(userId, 'terra', take),
      getPowerLiftGeneralRanking(userId, take),
    ]);
    return res.status(200).json({
      success: true,
      records: [...supino.entries, ...agachamento.entries, ...terra.entries].map(publicPowerLiftEntry),
      generalRanking: general.entries,
      rankingMode: 'per_exercise',
      season: supino.season,
      competitionSex: supino.competitionSex,
    });
  } catch (error: any) {
    console.error('[PowerLift] Falha ao carregar ranking:', error?.message || 'erro desconhecido');
    return res.status(500).json({ error: error?.message || 'Não foi possível carregar o ranking agora.' });
  }
}

async function handleStatus(_req: any, res: any, userId: string) {
  try {
    const status = await getPowerLiftSeasonStatus(userId);
    return res.status(200).json({ success: true, ...status });
  } catch (error: any) {
    return res.status(409).json({ error: error?.message || 'Não foi possível carregar o estado da temporada.' });
  }
}

async function handleOptIn(req: any, res: any, userId: string) {
  const scope = req.body?.scope === 'general' ? 'general' : req.body?.scope === 'elite' ? 'elite' : null;
  const exercise = req.body?.exercise ? parseExercise(req.body.exercise) : undefined;
  const optedIn = req.body?.optedIn === true;
  if (!scope) return res.status(400).json({ error: 'Escopo de ranking inválido.' });
  try {
    const result = await setPowerLiftRankingOptIn({ userId, scope, exercise: exercise || undefined, optedIn });
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    return res.status(409).json({ error: error?.message || 'Não foi possível atualizar sua participação no ranking.' });
  }
}

async function handleMyRecords(_req: any, res: any, userId: string) {
  try {
    const snap = await db.collection('power_records')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(MAX_MY_RECORDS)
      .get();
    return res.status(200).json({
      success: true,
      season: resolvePowerLiftSeason(new Date()),
      records: snap.docs.map((item: any) => publicRecord({ id: item.id, ...item.data() }, true))
    });
  } catch (error: any) {
    try {
      const snap = await db.collection('power_records').where('userId', '==', userId).limit(MAX_MY_RECORDS).get();
      const records = snap.docs
        .map((item: any) => ({ id: item.id, ...item.data() }))
        .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map((record: any) => publicRecord(record, true));
      return res.status(200).json({ success: true, season: resolvePowerLiftSeason(new Date()), records, degraded: true });
    } catch (fallbackError: any) {
      console.error('[PowerLift] Falha ao carregar registros próprios:', fallbackError?.message || error?.message || 'erro desconhecido');
      return res.status(500).json({ error: 'Não foi possível carregar seus levantamentos agora.' });
    }
  }
}

async function handleVideo(req: any, res: any, userId: string) {
  const recordId = safeText(req.query.id, 160);
  if (!recordId) return res.status(400).json({ error: 'Vídeo não informado.' });

  try {
    const snap = await db.collection('power_records').doc(recordId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Vídeo não encontrado.' });
    const record = snap.data() || {};
    const canWatch = record.videoStatus === 'approved' || record.userId === userId;
    if (!canWatch) return res.status(403).json({ error: 'Este vídeo ainda não está homologado.' });

    const storagePath = safeText(record.storagePath, 512);
    if (!storagePath || !storagePath.startsWith(`power_records/${record.userId}/`)) {
      return res.status(409).json({ error: 'O arquivo seguro deste vídeo não está disponível.' });
    }

    const expiresAt = Date.now() + 15 * 60 * 1000;
    const [url] = await getStorage(app).bucket().file(storagePath).getSignedUrl({ action: 'read', expires: expiresAt });
    return res.status(200).json({ success: true, url, expiresAt: new Date(expiresAt).toISOString() });
  } catch (error: any) {
    console.error('[PowerLift] Falha ao gerar reprodução segura:', error?.message || error);
    return res.status(500).json({ error: 'Não foi possível abrir este vídeo agora.' });
  }
}

async function handleFinalizeAudit(req: any, res: any, userId: string) {
  const recordId = safeText(req.body?.recordId, 160);
  const validationId = safeText(req.body?.validationId, 128);
  if (!recordId || !/^[A-Za-z0-9_-]{8,128}$/.test(validationId)) {
    return res.status(400).json({ error: 'Auditoria inválida.' });
  }

  const recordRef = db.collection('power_records').doc(recordId);
  const validationRef = db.collection('power_validation_sessions').doc(validationId);
  const auditRef = db.collection('power_audit_logs').doc(`audit_${recordId}`);
  try {
    const result = await db.runTransaction(async (transaction: any) => {
      const [recordSnap, validationSnap] = await Promise.all([
        transaction.get(recordRef),
        transaction.get(validationRef)
      ]);
      if (!recordSnap.exists || !validationSnap.exists) throw new Error('Registro ou auditoria não encontrado.');
      const record = recordSnap.data() || {};
      const validation = validationSnap.data() as StoredValidation;
      if (record.userId !== userId || validation.userId !== userId) throw new Error('Auditoria não pertence ao atleta.');
      if (record.exercise !== validation.exercise || Number(record.weight) !== Number(validation.weight)) {
        throw new Error('Auditoria não corresponde ao levantamento.');
      }
      if (validation.consumedAt || validation.recordId) throw new Error('Auditoria já utilizada.');
      if (new Date(validation.expiresAt).getTime() <= Date.now()) throw new Error('Auditoria expirada.');

      const confidence = Math.max(0, Math.min(100, Number(validation.confidence) || 0));
      const status = resolvePowerLiftAuditStatus(validation.decision, confidence);
      const now = new Date().toISOString();
      const updates = {
        videoStatus: status,
        confidence,
        userMessage: safeText(validation.analysis, 2000),
        motives: safeMotives(validation.motives),
        updatedAt: now,
        ...(status === 'approved' ? { approvedAt: now, approvalSource: 'server_validation_session' } : {}),
        ...(status === 'rejected' ? { rejectedAt: now, rejectionReason: safeMotives(validation.motives)[0] || 'O vídeo não atendeu aos critérios.' } : {})
      };
      transaction.update(recordRef, updates);
      transaction.update(validationRef, { consumedAt: now, recordId, effectiveDecision: status });

      if (status === 'rejected' && record.dailySlotId) {
        transaction.delete(db.collection('powerlift_daily_slots').doc(String(record.dailySlotId)));
      }

      transaction.set(auditRef, {
        recordId,
        userId,
        exercise: record.exercise,
        declaredWeight: Number(record.weight) || 0,
        powerVolume: Number(record.powerVolume) || Number(record.weight) || 0,
        series: Array.isArray(record.series) ? record.series : [],
        seasonId: record.seasonId || '',
        competitionSex: record.competitionSex || '',
        estimatedWeight: parseWeight(validation.estimatedWeight) ?? (Number(record.weight) || 0),
        confidence,
        result: status === 'approved' ? 'VALIDADO' : status === 'rejected' ? 'REPROVADO' : 'AUDITORIA_MANUAL',
        motivos: safeMotives(validation.motives),
        analysis: safeText(validation.analysis, 2000),
        videoUrl: record.videoUrl || '',
        storagePath: record.storagePath || '',
        timestamp: now,
        aiVersion: 'Invictus Audit Server v3',
        scoringVersion: 'powerlift-season-v1',
        validationId
      }, { merge: true });
      return { id: recordId, ...record, ...updates };
    });

    let stored: Record<string, any> = result;
    let progression: Record<string, any> | null = null;
    if (result.videoStatus === 'approved') {
      try {
        progression = await applyApprovedPowerLiftRecord(recordId);
        const refreshed = await recordRef.get();
        if (refreshed.exists) stored = { id: refreshed.id, ...refreshed.data() };
      } catch (progressionError) {
        console.warn('[PowerLift] Aprovação persistida; progressão ficará para reconciliação:', progressionError);
      }
    }
    return res.status(200).json({
      success: true,
      decision: stored.videoStatus,
      record: publicRecord(stored, true),
      progression,
      progressionPending: stored.videoStatus === 'approved' && !progression,
    });
  } catch (error: any) {
    console.warn('[PowerLift] Não foi possível finalizar auditoria assíncrona:', error?.message || error);
    return res.status(409).json({ error: 'O vídeo permanece em análise e poderá ser revisado manualmente.' });
  }
}

export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  // Power Lift é 100% exclusivo do plano PRO. Isso protege TODAS as ações
  // deste handler (status, me, submit, finalize-audit, opt-in -- Elite e
  // Geral -- e ranking) num único ponto, antes de qualquer despacho, usando
  // a mesma política canônica do frontend (isProUser espelha
  // hasActiveProEntitlement, incluindo o bypass funcional de admin ativo).
  // O frontend nunca é a única proteção: a rota /power some sem PRO, mas
  // mesmo uma chamada direta à API cai aqui.
  let serverUserData: Record<string, any> | null = null;
  try {
    const userSnap = await db.collection('users').doc(auth.uid).get();
    serverUserData = userSnap.exists ? (userSnap.data() || {}) : null;
    if (!isProUser(serverUserData)) {
      return res.status(403).json({ error: 'Power Lift é exclusivo do plano PRO.', code: 'PRO_REQUIRED' });
    }
  } catch (entitlementErr) {
    console.warn('[PowerLift] Não foi possível verificar o plano PRO:', entitlementErr);
    return res.status(503).json({
      error: 'Não foi possível confirmar seu plano agora. Tente novamente em instantes.',
      code: 'ENTITLEMENT_UNAVAILABLE', retryable: true,
    });
  }

  const action = safeText(req.query.action || req.body?.action || (req.method === 'GET' ? 'ranking' : ''), 32);
  if (req.method === 'POST' && action === 'submit') return handleSubmit(req, res, auth.uid);
  if (req.method === 'POST' && action === 'finalize-audit') return handleFinalizeAudit(req, res, auth.uid);
  if (req.method === 'POST' && action === 'opt-in') return handleOptIn(req, res, auth.uid);
  if (req.method === 'GET' && action === 'status') return handleStatus(req, res, auth.uid);
  if (req.method === 'GET' && action === 'ranking') return handleRanking(req, res, auth.uid);
  if (req.method === 'GET' && action === 'me') return handleMyRecords(req, res, auth.uid);
  if (req.method === 'GET' && action === 'video') return handleVideo(req, res, auth.uid);
  return res.status(405).json({ error: 'Ação Power Lift não suportada.' });
}
