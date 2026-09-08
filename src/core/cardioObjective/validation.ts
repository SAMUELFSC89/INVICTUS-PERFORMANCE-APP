import { z } from 'zod';
import { FOOD_LABELS, GOALS } from './types.js';

export const safetySchema = z.object({
  screened: z.literal(true),
  signals: z.array(z.enum(['chest_pain', 'fainting', 'dizziness', 'unusual_breathlessness', 'surgical_recovery', 'pain'])).max(6),
  medicalClearance: z.boolean().nullable(),
}).strict();
export const barrierSchema = z.enum(['time', 'fatigue', 'starting', 'hunger', 'sweets', 'anxiety', 'dislike_running', 'pain', 'restart', 'unpredictable', 'food', 'other']);
export const answersSchema = z.object({
  goalType: z.enum(Object.keys(GOALS) as [keyof typeof GOALS, ...(keyof typeof GOALS)[]]),
  otherGoal: z.string().trim().min(3).max(160).optional(),
  walkingMinutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(45)]),
  runningAbility: z.enum(['none', 'seconds', 'minutes', 'regular', 'structured']),
  availableMinutes: z.union([z.literal(10), z.literal(15), z.literal(25), z.literal(40), z.literal(50)]),
  availableDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length),
  timeZone: z.string().max(80).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  preferredMoment: z.enum(['post_workout', 'pre_workout', 'rest_days', 'morning', 'afternoon', 'night', 'any']),
  preferredActivity: z.enum(['walking', 'running', 'bike', 'stationary_bike', 'treadmill']),
  barrier: barrierSchema, confidenceScore: z.number().int().min(0).max(10),
  weightConfirmed: z.boolean().optional(), currentWeightKg: z.number().min(30).max(350).optional(),
  loseKg: z.number().positive().max(30).optional(),
  targetDistanceKm: z.number().min(1).max(42.2).optional(), targetContinuousMinutes: z.number().int().min(5).max(60).optional(),
  safety: safetySchema, productConsent: z.literal(true),
  nutrition: z.object({
    meals: z.enum(['2', '3', '4', '5+', 'variable']),
    frequencies: z.partialRecord(z.enum(Object.keys(FOOD_LABELS) as [keyof typeof FOOD_LABELS, ...(keyof typeof FOOD_LABELS)[]]), z.enum(['rarely', 'weekly', 'daily', 'multiple_daily'])),
    hardestTime: z.enum(['morning', 'afternoon', 'night', 'late_night', 'weekend']),
  }).strict().optional(),
}).strict().superRefine((a, ctx) => {
  if (a.goalType === 'lose_weight' && (!a.weightConfirmed || !a.currentWeightKg || !a.loseKg || !a.nutrition || a.currentWeightKg - a.loseKg < 30)) ctx.addIssue({ code: 'custom', message: 'Confirme o peso, o objetivo e os hábitos relevantes.' });
  if (a.goalType === 'other' && !a.otherGoal) ctx.addIssue({ code: 'custom', message: 'Descreva seu objetivo em uma frase.' });
  if (a.goalType === 'race' && !a.targetDistanceKm) ctx.addIssue({ code: 'custom', message: 'Informe a distância da prova.' });
  if (a.goalType !== 'lose_weight' && a.nutrition) ctx.addIssue({ code: 'custom', message: 'Informações alimentares não são necessárias para este objetivo.' });
});
export const reviewSchema = z.object({
  difficulty: z.enum(['easy', 'appropriate', 'hard', 'very_hard']), energy: z.enum(['poor', 'fair', 'good', 'great']),
  confidenceScore: z.number().int().min(0).max(10), hunger: z.enum(['low', 'normal', 'high', 'very_high']).optional(),
  habitAdherence: z.enum(['yes', 'partly', 'no']), barrier: barrierSchema, safety: safetySchema,
  weightKg: z.number().min(30).max(350).optional(),
}).strict();
export const identifierSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
