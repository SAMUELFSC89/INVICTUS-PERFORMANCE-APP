import { z } from 'zod';

// Schema para atividade de corrida
export const RunActivitySchema = z.object({
  type: z.literal('run'),
  distance: z.number().positive('Distance must be positive').max(200, 'Too high'),
  duration: z.number().positive().max(14400, '4 hours max'),
  avgPace: z.number().positive().max(600),
  source: z.enum(['app', 'strava', 'manual']),
  timestamp: z.coerce.date(),
  avgSpeed: z.number().positive().optional(),
  maxHeartRate: z.number().int().min(60).max(220).optional(),
  notes: z.string().max(500).optional(),
  coordinates: z.array(z.object({
    lat: z.number(),
    lng: z.number(),
    timestamp: z.number()
  })).optional()
});

// Schema para checkin em academia
export const GymCheckInSchema = z.object({
  type: z.literal('gym'),
  gymId: z.string().min(1),
  duration: z.number().positive().max(7200),
  timestamp: z.coerce.date(),
  exercises: z.array(z.object({
    name: z.string(),
    sets: z.number().int().positive(),
    reps: z.number().int().positive(),
    weight: z.number().positive().optional()
  })).min(1)
});

// Schema para atividade customizada
export const CustomActivitySchema = z.object({
  type: z.literal('custom'),
  name: z.string().min(1).max(100),
  duration: z.number().positive(),
  intensity: z.enum(['light', 'moderate', 'high']),
  timestamp: z.coerce.date()
});

// Schema para dieta
export const DietEntrySchema = z.object({
  type: z.literal('diet'),
  mealType: z.enum(['breakfast', 'lunch', 'snack', 'dinner']),
  foods: z.array(z.object({
    name: z.string(),
    calories: z.number().positive()
  })).min(1),
  totalCalories: z.number().positive(),
  timestamp: z.coerce.date()
});

// Union de todas as atividades
export const ActivityPayloadSchema = z.discriminatedUnion('type', [
  RunActivitySchema,
  GymCheckInSchema,
  CustomActivitySchema,
  DietEntrySchema
]);

// Tipos TypeScript derivados automaticamente
export type RunActivity = z.infer<typeof RunActivitySchema>;
export type GymCheckIn = z.infer<typeof GymCheckInSchema>;
export type CustomActivity = z.infer<typeof CustomActivitySchema>;
export type DietEntry = z.infer<typeof DietEntrySchema>;
export type ActivityPayload = z.infer<typeof ActivityPayloadSchema>;

// Função utilitária de validação
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown) {
  try {
    const validated = schema.parse(data);
    return { success: true as const, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false as const,
        error: {
          message: 'Validation failed',
          details: error.issues.map(e => ({
            path: e.path.join('.'),
            message: e.message,
            code: e.code
          }))
        }
      };
    }
    throw error;
  }
}

export default {
  RunActivitySchema,
  GymCheckInSchema,
  CustomActivitySchema,
  DietEntrySchema,
  ActivityPayloadSchema,
  validateInput
};
