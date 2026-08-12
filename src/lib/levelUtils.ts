/**
 * Levels and Progressive Difficulties Utility
 */

/**
 * Returns the cumulative XP required to reach a specific level.
 * Level 1: 0 XP
 * Level 2: 100 XP (requires 100 XP)
 * Level 3: 250 XP (requires 150 XP)
 * Level 4: 450 XP (requires 200 XP)
 * ...
 * For level L: 25 * (L - 1) * (L + 2)
 */
export function getXPRequiredForLevel(level: number): number {
  if (level <= 1) return 0;
  return 25 * (level - 1) * (level + 2);
}

/**
 * Calculates the user's level based on cumulative experience points (XP).
 * Uses a safe lookup because the level scale is ~1 to 1000+.
 */
export function getLevelFromXP(xp: number = 0): number {
  const safeXP = Math.max(0, Number(xp) || 0);
  if (safeXP <= 0) return 1;
  let level = 1;
  while (true) {
    const nextLevelXP = getXPRequiredForLevel(level + 1);
    if (safeXP >= nextLevelXP) {
      level++;
    } else {
      break;
    }
  }
  return level;
}

/**
 * Returns detailed progress information for a progress rendering engine.
 */
export function getXPProgress(xp: number = 0) {
  const safeXP = Math.max(0, Number(xp) || 0);
  const currentLevel = getLevelFromXP(safeXP);
  const nextLevel = currentLevel + 1;
  
  const xpFloor = getXPRequiredForLevel(currentLevel);
  const xpCeiling = getXPRequiredForLevel(nextLevel);
  
  const xpInCurrentLevel = safeXP - xpFloor;
  const xpNeededForNextLevel = xpCeiling - xpFloor;
  
  const percentage = xpNeededForNextLevel > 0 
    ? Math.min(100, Math.max(0, (xpInCurrentLevel / xpNeededForNextLevel) * 100))
    : 100;
    
  return {
    currentLevel,
    nextLevel,
    xpFloor,
    xpCeiling,
    xpInCurrentLevel,
    xpNeededForNextLevel,
    percentage
  };
}

/**
 * Progressively calculates the barbell weight based on active level.
 * Level 1 starts with a 8 kilogram barbell.
 * Level 2 starts with a 10 kilogram barbell.
 * Progressive increase of 2 kg per level, capping at 220 kilograms.
 */
export function getBarbellWeight(level: number): number {
  const calculated = 8 + (level - 1) * 2;
  return Math.min(220, calculated);
}

/**
 * Get the classification title based on user level.
 */
export function getLevelTitle(level: number): string {
  if (level >= 76) return 'Invictus';
  if (level >= 51) return 'Lenda';
  if (level >= 31) return 'Elite';
  if (level >= 21) return 'Imparável';
  if (level >= 11) return 'Consistente';
  if (level >= 6) return 'Determinado';
  return 'Iniciante';
}

/**
 * Level progression motivational phrases.
 */
export const LEVEL_MOTIVATIONAL_PHRASES = [
  "Você está ficando imparável.",
  "Consistência gera evolução.",
  "Mais forte que ontem.",
  "Continue avançando.",
  "Um novo nível foi conquistado."
];

export function getRandomMotivationalPhrase(): string {
  const idx = Math.floor(Math.random() * LEVEL_MOTIVATIONAL_PHRASES.length);
  return LEVEL_MOTIVATIONAL_PHRASES[idx];
}

