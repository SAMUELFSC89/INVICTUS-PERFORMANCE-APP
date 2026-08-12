import { Achievement } from './types';

export const ACHIEVEMENTS: Achievement[] = [
  // Frequency
  { id: 'streak_3', name: 'Iniciante Consistente', description: '3 dias seguidos de treino', icon: '🔥', criteria: 'streak >= 3', category: 'frequency', points: 10 },
  { id: 'streak_7', name: 'Estilo INVICTUS', description: '7 dias seguidos de treino', icon: '🔥', criteria: 'streak >= 7', category: 'frequency', points: 30 },
  { id: 'streak_15', name: 'Comprometido', description: '15 dias seguidos de treino', icon: '🔥', criteria: 'streak >= 15', category: 'frequency', points: 70 },
  { id: 'streak_30', name: 'Imparável', description: '30 dias seguidos de treino', icon: '🔥', criteria: 'streak >= 30', category: 'frequency', points: 150 },
  { id: 'streak_60', name: 'Elite', description: '60 dias seguidos de treino', icon: '🔥', criteria: 'streak >= 60', category: 'frequency', points: 300 },
  { id: 'streak_100', name: 'Lenda', description: '100 dias seguidos de treino', icon: '🔥', criteria: 'streak >= 100', category: 'frequency', points: 600 },

  // Performance
  { id: 'first_workout', name: 'Primeiro Passo', description: 'Realizou seu primeiro treino', icon: '👟', criteria: 'totalWorkouts >= 1', category: 'performance', points: 5 },
  { id: 'workouts_10', name: 'Dez de Dez', description: '10 treinos realizados', icon: '🏋️', criteria: 'totalWorkouts >= 10', category: 'performance', points: 50 },
  { id: 'workouts_50', name: 'Dedicado', description: '50 treinos realizados', icon: '🏋️', criteria: 'totalWorkouts >= 50', category: 'performance', points: 200 },
  { id: 'workouts_100', name: 'Atleta', description: '100 treinos realizados', icon: '🏋️', criteria: 'totalWorkouts >= 100', category: 'performance', points: 500 },

  // Social
  { id: 'first_post', name: 'Socializando', description: 'Fez sua primeira postagem', icon: '📸', criteria: 'postsCount >= 1', category: 'social', points: 10 },
  { id: 'followers_10', name: 'Pequena Audiência', description: 'Conquistou 10 seguidores', icon: '👥', criteria: 'followersCount >= 10', category: 'social', points: 50 },
  { id: 'followers_50', name: 'Influente', description: 'Conquistou 50 seguidores', icon: '🌟', criteria: 'followersCount >= 50', category: 'social', points: 200 },

  // Ranking
  { id: 'top_10', name: 'Elite dos 10', description: 'Entrou no Top 10 do ranking', icon: '🎖️', criteria: 'ranking <= 10', category: 'ranking', points: 300 },
  { id: 'top_5', name: 'Dominador do Top 5', description: 'Entrou no Top 5 do ranking', icon: '🏅', criteria: 'ranking <= 5', category: 'ranking', points: 600 },
  { id: 'top_3', name: 'Pódio dos Atletas', description: 'Conquistou o Top 3 do ranking', icon: '🥈', criteria: 'ranking <= 3', category: 'ranking', points: 1000 },
  { id: 'champion', name: 'Campeão Supremo', description: 'Ficou em 1º lugar no ranking', icon: '🏆', criteria: 'ranking == 1', category: 'ranking', points: 2500 },
  
  // Layer Specific
  { id: 'gym_leader', name: 'Lenda da Academia', description: 'Ficou em 1º lugar na sua academia', icon: '🏢', criteria: 'gym_rank == 1', category: 'ranking', points: 500 },
  { id: 'city_champion', name: 'Orgulho da Cidade', description: 'Ficou no Top 3 da sua cidade', icon: '🏙️', criteria: 'city_rank <= 3', category: 'ranking', points: 1000 },
  { id: 'national_elite', name: 'Elite Nacional', description: 'Ficou no Top 10 Nacional', icon: '🇧🇷', criteria: 'national_rank <= 10', category: 'ranking', points: 2000 },
];
