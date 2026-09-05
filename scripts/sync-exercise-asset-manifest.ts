/** Run: node --import tsx scripts/sync-exercise-asset-manifest.ts [--check] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_EXERCISES_BATCH_01, OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS } from '../src/data/exerciseCatalog';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = '/assets/exercise-library/rebuild-2026-09-05/';
const directory = path.join(root, 'public', base);
const destination = path.join(directory, 'manifest.json');
const ids = new Set<string>();
const exercises = OFFICIAL_EXERCISES_BATCH_01.map(exercise => {
  if (ids.has(exercise.id)) throw new Error(`Duplicate ID: ${exercise.id}`);
  ids.add(exercise.id);
  if (exercise.thumbUrl !== `${base}${exercise.id}/thumb.webp`) throw new Error(`Unexpected path: ${exercise.id}`);
  if (exercise.thumbStatus === 'ready' && !fs.existsSync(path.join(root, 'public', exercise.thumbUrl))) throw new Error(`Missing image marked ready: ${exercise.id}`);
  if (!Object.hasOwn(OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS, exercise.id)) throw new Error(`Missing equipment requirements: ${exercise.id}`);
  if (exercise.demoStatus === 'ready' && !exercise.demoUrl) throw new Error(`Missing demo URL: ${exercise.id}`);
  return {
    id: exercise.id,
    name: exercise.name,
    muscleGroup: exercise.muscleGroup,
    ...(exercise.muscleSubgroup ? { muscleSubgroup: exercise.muscleSubgroup } : {}),
    equipment: exercise.equipment,
    equipmentRequirements: OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS[exercise.id],
    thumb: exercise.thumbUrl.slice(base.length),
    ...(exercise.thumbFallbackUrl ? { thumbFallbackUrl: exercise.thumbFallbackUrl } : {}),
    thumbStatus: exercise.thumbStatus,
    demoStatus: exercise.demoStatus,
    ...(exercise.demoUrl ? { demoUrl: exercise.demoUrl, demoLoop: exercise.demoLoop === true } : {}),
  };
});
const contents = JSON.stringify({
  schemaVersion: 1,
  version: 'rebuild-2026-09-05',
  background: 'black',
  source: 'src/data/exerciseCatalog.ts',
  animationPolicy: 'only_real_reviewed_video_loaded_on_request',
  exercises,
}, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== contents) throw new Error('Manifest is stale: run this script without --check.');
} else {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(destination, contents);
}
console.log(`Exercise asset manifest: ${exercises.length} records verified.`);
