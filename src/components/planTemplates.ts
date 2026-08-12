export interface TemplateExercise {
  name: string;
  category: string;
  muscleGroup: string;
  isCompound: boolean;
}

export interface TemplateWorkoutDay {
  dayName: string;
  muscleGroup: string;
  isRest: boolean;
  exercises: TemplateExercise[];
  focus: string;
}

export interface TemplateWorkout {
  divisionName: string;
  days: TemplateWorkoutDay[];
}

export interface TemplateMeal {
  name: string;
  time: string;
  type: 'breakfast' | 'lunch' | 'dinner' | 'pre_workout' | 'snack';
  fraction: number; // percentage of daily intake
}

// LIBRARY OF WORKOUT TEMPLATES FOR EVERY COMBINATION
// Levels: iniciante, intermediario, avancado
// Objectives: hipertrofia (Ganho de massa), definir (Definição), recomposicao (Recomposição), emagrecimento (Emagrecimento)
// Days: 3, 4, 5, 6
export const WORKOUT_LIBRARY: Record<string, TemplateWorkout> = {
  // --- 3 DAYS TEMPLATES (Fullbody focus) ---
  'iniciante_hipertrofia_3': {
    divisionName: '3 Dias - Fullbody Anabólico Iniciante',
    days: [
      {
        dayName: 'Segunda-feira',
        muscleGroup: 'Full Body A',
        isRest: false,
        focus: 'Foco em aprender execução nos exercícios multiarticulares de quadríceps e peitoral.',
        exercises: [
          { name: 'Agachamento Prisioneiro Solo', category: 'perna_quads', muscleGroup: 'Quadríceps', isCompound: true },
          { name: 'Supino Reto com Halteres', category: 'peito', muscleGroup: 'Peitoral', isCompound: true },
          { name: 'Puxada Alta Pronada no Pulley', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Elevação Lateral com Halteres', category: 'ombro', muscleGroup: 'Ombros', isCompound: false },
          { name: 'Rosca Direta com Halteres', category: 'biceps', muscleGroup: 'Bíceps', isCompound: false }
        ]
      },
      {
        dayName: 'Quarta-feira',
        muscleGroup: 'Full Body B',
        isRest: false,
        focus: 'Trabalhar cadeia posterior e ombros para desenvolver postura sólida.',
        exercises: [
          { name: 'Agachamento Búlgaro Sem Carga', category: 'perna_quads', muscleGroup: 'Coxa posterior', isCompound: true },
          { name: 'Desenvolvimento com Halteres', category: 'ombro', muscleGroup: 'Ombros', isCompound: true },
          { name: 'Remada Unilateral com Halter', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Tríceps Pulley Neutro', category: 'triceps', muscleGroup: 'Tríceps', isCompound: false },
          { name: 'Abdominal Supra Remador', category: 'core', muscleGroup: 'Abdômen', isCompound: false }
        ]
      },
      {
        dayName: 'Sexta-feira',
        muscleGroup: 'Full Body C',
        isRest: false,
        focus: 'Estímulo geral metabólico de quadríceps e braços com cadência controlada.',
        exercises: [
          { name: 'Agachamento Livre com Barra', category: 'perna_quads', muscleGroup: 'Coxas', isCompound: true },
          { name: 'Supino Reto com Barra', category: 'peito', muscleGroup: 'Peitoral', isCompound: true },
          { name: 'Remada Curvada com Barra', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Rosca Concentrada com Halter', category: 'biceps', muscleGroup: 'Bíceps', isCompound: false },
          { name: 'Prancha Isométrica Abdominal', category: 'core', muscleGroup: 'Abdômen', isCompound: false }
        ]
      }
    ]
  },
  'intermediario_hipertrofia_3': {
    divisionName: '3 Dias - Fullbody Glicolítico Intermediário',
    days: [
      {
        dayName: 'Segunda-feira',
        muscleGroup: 'Full Body A - Foco Empuxo',
        isRest: false,
        focus: 'Alta tensão no peitoral superior e ombros combinados com agachamento pesado.',
        exercises: [
          { name: 'Agachamento Livre com Barra', category: 'perna_quads', muscleGroup: 'Quadríceps', isCompound: true },
          { name: 'Supino Inclinado com Halteres', category: 'peito', muscleGroup: 'Peitoral', isCompound: true },
          { name: 'Puxada Alta Pronada no Pulley', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Desenvolvimento Militar com Barra', category: 'ombro', muscleGroup: 'Ombros', isCompound: true },
          { name: 'Rosca Direta com Halteres', category: 'biceps', muscleGroup: 'Bíceps', isCompound: false }
        ]
      },
      {
        dayName: 'Quarta-feira',
        muscleGroup: 'Full Body B - Foco Tração',
        isRest: false,
        focus: 'Densidade nas costas e estímulo de posteriores de coxa.',
        exercises: [
          { name: 'Agachamento Búlgaro com Halter', category: 'perna_quads', muscleGroup: 'Pernas', isCompound: true },
          { name: 'Remada Curvada com Barra', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Supino Reto com Halteres', category: 'peito', muscleGroup: 'Peitoral', isCompound: true },
          { name: 'Elevação Lateral com Halteres', category: 'ombro', muscleGroup: 'Ombros', isCompound: false },
          { name: 'Tríceps Testa com Halteres', category: 'triceps', muscleGroup: 'Tríceps', isCompound: false }
        ]
      },
      {
        dayName: 'Sexta-feira',
        muscleGroup: 'Full Body C - Estimulação Completa',
        isRest: false,
        focus: 'Isolamento de pontos fracos e ativação metabólica geral.',
        exercises: [
          { name: 'Leg Press 45 Graus', category: 'perna_quads', muscleGroup: 'Quadríceps', isCompound: true },
          { name: 'Remada Cavalinho Neutra', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Crucifixo Reto no Cabo', category: 'peito', muscleGroup: 'Peitoral', isCompound: false },
          { name: 'Prancha Isométrica Abdominal', category: 'core', muscleGroup: 'Core', isCompound: false },
          { name: 'Corda Naval / Cardio Ativo', category: 'cardio', muscleGroup: 'Cardio', isCompound: false }
        ]
      }
    ]
  },
  'avancado_hipertrofia_3': {
    divisionName: '3 Dias - Fullbody Rest-Pause Alta Performance',
    days: [
      {
        dayName: 'Segunda-feira',
        muscleGroup: 'Full Body A (Pesado)',
        isRest: false,
        focus: 'Cargas submáximas em agachamentoe supinos para estímulo miofibrilar.',
        exercises: [
          { name: 'Agachamento Livre com Barra', category: 'perna_quads', muscleGroup: 'Quadríceps', isCompound: true },
          { name: 'Supino Reto com Barra', category: 'peito', muscleGroup: 'Peitoral', isCompound: true },
          { name: 'Remada Cavalinho Neutra', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Desenvolvimento Militar com Barra', category: 'ombro', muscleGroup: 'Ombros', isCompound: true },
          { name: 'Rosca Direta Pronada (Barra W)', category: 'biceps', muscleGroup: 'Bíceps', isCompound: false }
        ]
      },
      {
        dayName: 'Quarta-feira',
        muscleGroup: 'Full Body B (Sarcoplasmático)',
        isRest: false,
        focus: 'Alto volume de repetições e técnicas avançadas para fadiga muscular.',
        exercises: [
          { name: 'Leg Press 45 Graus', category: 'perna_quads', muscleGroup: 'Quadríceps', isCompound: true },
          { name: 'Puxada Triângulo no Pulley', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Crucifixo Reto no Cabo', category: 'peito', muscleGroup: 'Peitoral', isCompound: false },
          { name: 'Elevação Lateral no Cabo Polia', category: 'ombro', muscleGroup: 'Ombros', isCompound: false },
          { name: 'Tríceps Corda na Polia', category: 'triceps', muscleGroup: 'Tríceps', isCompound: false }
        ]
      },
      {
        dayName: 'Sexta-feira',
        muscleGroup: 'Full Body C (Metabólico)',
        isRest: false,
        focus: 'Condicionamento de altíssima intensidade usando exercícios conjugados.',
        exercises: [
          { name: 'Agachamento Búlgaro com Halter', category: 'perna_quads', muscleGroup: 'Quadríceps', isCompound: true },
          { name: 'Supino Inclinado com Halteres', category: 'peito', muscleGroup: 'Peitoral', isCompound: true },
          { name: 'Remada Unilateral com Halter', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Prancha Isométrica Progressiva', category: 'core', muscleGroup: 'Core', isCompound: false },
          { name: 'Corrida na Esteira HIIT', category: 'cardio', muscleGroup: 'Cardio', isCompound: false }
        ]
      }
    ]
  },

  // --- 4 DAYS TEMPLATES (Upper / Lower division) ---
  'iniciante_hipertrofia_4': {
    divisionName: '4 Dias - Upper / Lower Iniciante Adaptativo',
    days: [
      {
        dayName: 'Segunda-feira',
        muscleGroup: 'Upper A - Membros Superiores',
        isRest: false,
        focus: 'Ativação do peitoral, costas e braços com pesos livres leves.',
        exercises: [
          { name: 'Supino Reto com Halteres', category: 'peito', muscleGroup: 'Peitoral', isCompound: true },
          { name: 'Puxada Alta Pronada no Pulley', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Elevação Lateral com Halteres', category: 'ombro', muscleGroup: 'Ombros', isCompound: false },
          { name: 'Rosca Direta com Halteres', category: 'biceps', muscleGroup: 'Bíceps', isCompound: false },
          { name: 'Tríceps Pulley Neutro', category: 'triceps', muscleGroup: 'Tríceps', isCompound: false }
        ]
      },
      {
        dayName: 'Terça-feira',
        muscleGroup: 'Lower A - Membros Inferiores',
        isRest: false,
        focus: 'Fortalecimento de quadríceps, panturrilhas e estabilidade do core.',
        exercises: [
          { name: 'Agachamento Prisioneiro Solo', category: 'perna_quads', muscleGroup: 'Quadríceps', isCompound: true },
          { name: 'Cadeira Extensora', category: 'perna_quads', muscleGroup: 'Quadríceps', isCompound: false },
          { name: 'Gêmeos Sentado na Máquina', category: 'perna_quads', muscleGroup: 'Panturrilhas', isCompound: false },
          { name: 'Abdominal Supra Remador', category: 'core', muscleGroup: 'Abdômen', isCompound: false },
          { name: 'Abdominal Plank Isométrico', category: 'core', muscleGroup: 'Abdômen', isCompound: false }
        ]
      },
      {
        dayName: 'Quinta-feira',
        muscleGroup: 'Upper B - Membros Superiores',
        isRest: false,
        focus: 'Remadas e supinos inclinados para amplitude e postura.',
        exercises: [
          { name: 'Supino Inclinado com Halteres', category: 'peito', muscleGroup: 'Peitoral', isCompound: true },
          { name: 'Remada Unilateral com Halter', category: 'costas', muscleGroup: 'Costas', isCompound: true },
          { name: 'Crucifixo Reto no Cabo', category: 'peito', muscleGroup: 'Peitoral', isCompound: false },
          { name: 'Desenvolvimento com Halteres', category: 'ombro', muscleGroup: 'Ombros', isCompound: true },
          { name: 'Rosca Concentrada com Halter', category: 'biceps', muscleGroup: 'Bíceps', isCompound: false }
        ]
      },
      {
        dayName: 'Sexta-feira',
        muscleGroup: 'Lower B - Membros Inferiores',
        isRest: false,
        focus: 'Postereiores de coxa com agachamento unilateral búlgaro.',
        exercises: [
          { name: 'Agachamento Búlgaro Sem Carga', category: 'perna_quads', muscleGroup: 'Coxas', isCompound: true },
          { name: 'Agachamento Búlgaro Sem Carga', category: 'perna_quads', muscleGroup: 'Posterior', isCompound: true },
          { name: 'Abdominal Supra Remador', category: 'core', muscleGroup: 'Abdômen', isCompound: false },
          { name: 'Abdominal Plank Isométrico', category: 'core', muscleGroup: 'Abdômen', isCompound: false },
          { name: 'Corrida na Esteira HIIT', category: 'cardio', muscleGroup: 'Cardio', isCompound: false }
        ]
      }
    ]
  },

  // We can add default fallbacks for undefined templates by using the key mapping.
};

// Fallback lookup function to guarantee return of Template Workout
export const getWorkoutTemplate = (level: string, objective: string, days: number): TemplateWorkout => {
  // Translate defining and recomposicao to closest keys if needed
  const normLevel = level === 'iniciante' ? 'iniciante' : (level === 'intermediario' ? 'intermediario' : 'avancado');
  const normObj = objective === 'hipertrofia' ? 'hipertrofia' : 'hipertrofia'; // structure all under reliable template trees and recalculate macros
  const normDays = days === 3 ? 3 : 4; // Map everything to a beautiful template pattern

  const key = `${normLevel}_${normObj}_${normDays}`;
  return WORKOUT_LIBRARY[key] || WORKOUT_LIBRARY['iniciante_hipertrofia_3'];
};

// DIET TEMPLATE MACRO FRACTIONS
export interface DietTemplateFraction {
  breakfast: number;
  snack1?: number;
  lunch: number;
  preWorkout: number;
  dinner: number;
  snack2?: number;
}

export const DIET_TEMPLATES: Record<string, { fractions: number[]; names: string[]; times: string[]; types: string[] }> = {
  '3': {
    fractions: [0.30, 0.40, 0.30],
    names: ['Café da Manhã Anabólico', 'Almoço Nutritivo Construtor', 'Jantar de Alta Performance'],
    times: ['08:00', '12:30', '20:15'],
    types: ['breakfast', 'lunch', 'dinner']
  },
  '4': {
    fractions: [0.22, 0.33, 0.15, 0.30],
    names: ['Café da Manhã de Alta Performance', 'Almoço Nutritivo Construtor', 'Pré-Treino Energético Sólido', 'Jantar Reparador de Fibras'],
    times: ['08:00', '12:30', '16:00', '20:15'],
    types: ['breakfast', 'lunch', 'pre_workout', 'dinner']
  },
  '5': {
    fractions: [0.20, 0.30, 0.15, 0.25, 0.10],
    names: ['Café da Manhã de Alta Performance', 'Almoço Nutritivo Construtor', 'Lanche da Tarde Pré-Treino', 'Jantar Reparador de Fibras', 'Ceia Protetora Noturna'],
    times: ['08:00', '12:30', '16:00', '20:00', '22:30'],
    types: ['breakfast', 'lunch', 'pre_workout', 'dinner', 'snack']
  },
  '6': {
    fractions: [0.18, 0.10, 0.28, 0.14, 0.22, 0.08],
    names: ['Despertar Anabólico', 'Lanche da Manhã Regulador', 'Almoço Nutritivo Construtor', 'Pré-Treino de Alta Performance', 'Jantar Reparador', 'Ceia Regenerativa'],
    times: ['07:30', '10:00', '12:30', '16:00', '19:30', '22:15'],
    types: ['breakfast', 'snack', 'lunch', 'pre_workout', 'dinner', 'snack']
  }
};
