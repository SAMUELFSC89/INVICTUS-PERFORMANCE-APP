import { db } from './api/_lib/common';

const CHALLENGE_TEMPLATES = [
  // 30 DIAS
  { id: 'ignite_80', seasonId: 'endeavor_2026', name: 'IGNITE', km: 80, days: 30, difficulty: 'Baixa', rarity: 'Comum', finishRate: 65, entryFee: 99.9, quotaMultiplier: 2.0 },
  { id: 'pulse_120', seasonId: 'endeavor_2026', name: 'PULSE', km: 120, days: 30, difficulty: 'Média', rarity: 'Rara', finishRate: 45, entryFee: 99.9, quotaMultiplier: 3.5 },
  { id: 'apex_160', seasonId: 'endeavor_2026', name: 'APEX', km: 160, days: 30, difficulty: 'Alta', rarity: 'Épica', finishRate: 25, entryFee: 99.9, quotaMultiplier: 5.0 },
  { id: 'titan_220', seasonId: 'endeavor_2026', name: 'TITAN', km: 220, days: 30, difficulty: 'Extrema', rarity: 'Mística', finishRate: 12, entryFee: 99.9, quotaMultiplier: 8.5 },
  
  // 60 DIAS
  { id: 'horizon_180', seasonId: 'endeavor_2026', name: 'HORIZON', km: 180, days: 60, difficulty: 'Baixa', rarity: 'Comum', finishRate: 55, entryFee: 99.9, quotaMultiplier: 2.5 },
  { id: 'elevate_260', seasonId: 'endeavor_2026', name: 'ELEVATE', km: 260, days: 60, difficulty: 'Média', rarity: 'Rara', finishRate: 35, entryFee: 99.9, quotaMultiplier: 4.0 },
  { id: 'velocity_340', seasonId: 'endeavor_2026', name: 'VELOCITY', km: 340, days: 60, difficulty: 'Alta', rarity: 'Épica', finishRate: 18, entryFee: 99.9, quotaMultiplier: 6.5 },
  { id: 'iron_path_450', seasonId: 'endeavor_2026', name: 'IRON PATH', km: 450, days: 60, difficulty: 'Extrema', rarity: 'Mística', finishRate: 8, entryFee: 99.9, quotaMultiplier: 12.0 },
  
  // 90 DIAS
  { id: 'odyssey_320', seasonId: 'endeavor_2026', name: 'ODYSSEY', km: 320, days: 90, difficulty: 'Baixa', rarity: 'Comum', finishRate: 45, entryFee: 99.9, quotaMultiplier: 3.0 },
  { id: 'black_route_500', seasonId: 'endeavor_2026', name: 'BLACK ROUTE', km: 500, days: 90, difficulty: 'Média', rarity: 'Rara', finishRate: 25, entryFee: 99.9, quotaMultiplier: 6.0 },
  { id: 'eternal_pace_700', seasonId: 'endeavor_2026', name: 'ETERNAL PACE', km: 700, days: 90, difficulty: 'Alta', rarity: 'Épica', finishRate: 12, entryFee: 99.9, quotaMultiplier: 10.0 },
  { id: 'immortal_1000', seasonId: 'endeavor_2026', name: 'IMMORTAL', km: 1000, days: 90, difficulty: 'Lendária', rarity: 'Mística', finishRate: 3, entryFee: 99.9, quotaMultiplier: 25.0 },
];

async function seed() {
  console.log('Seeding Elite Challenges...');
  
  const seasonId = 'endeavor_2026';
  await db.collection('seasons').doc(seasonId).set({
    name: 'ENDEAVOR 2026',
    theme: 'JORNADA INDIVIDUAL',
    medalIcon: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=800&auto=format&fit=crop",
    startDate: '2026-05-01T00:00:00Z',
    endDate: '2026-12-31T20:00:00Z',
    totalPool: 0,
    athletesCount: 0,
    status: 'active',
    description: 'A JORNADA DEFINITIVA DE SUPERAÇÃO.'
  });

  for (const challenge of CHALLENGE_TEMPLATES) {
    await db.collection('elite_challenges').doc(challenge.id).set(challenge);
  }

  console.log('Seed completed.');
}

seed().catch(console.error);
