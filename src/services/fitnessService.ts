import { UserProfile, League, BodySelfAssessment, TrainingObjective, WorkoutFrequency, Sex, Diet, Meal } from '../types';

export const fitnessService = {
  calculateIMC(weight: number, height: number): number {
    const heightInMeters = height / 100;
    return Number((weight / (heightInMeters * heightInMeters)).toFixed(1));
  },

  classifyLeague(
    imc: number,
    frequency: WorkoutFrequency,
    assessment: BodySelfAssessment
  ): League {
    if (assessment === 'maromba' || (frequency === '5+' && imc >= 22 && imc <= 26)) {
      return 'Liga Alpha';
    }
    if (assessment === 'normal' || assessment === 'definido' || frequency === '3-4' || imc < 30) {
      return 'Liga Beta';
    }
    return 'Liga Delta';
  },

  calculateDailyCalories(
    weight: number,
    height: number,
    age: number,
    sex: Sex,
    frequency: WorkoutFrequency,
    objective: TrainingObjective
  ): number {
    // Mifflin-St Jeor Equation
    let bmr = 10 * weight + 6.25 * height - 5 * age;
    bmr = sex === 'male' ? bmr + 5 : bmr - 161;

    // Activity Factor
    const activityFactors = {
      '0-2': 1.2,
      '3-4': 1.375,
      '5+': 1.55
    };
    const tdee = bmr * activityFactors[frequency];

    // Objective Adjustment
    if (objective === 'emagrecer') return Math.round(tdee * 0.8); // 20% deficit
    if (objective === 'ganhar_massa') return Math.round(tdee * 1.1); // 10% surplus
    return Math.round(tdee); // Maintenance (definir)
  },

  calculateMacros(calories: number, objective: TrainingObjective, weight: number) {
    let proteinPerKg = 2.0;
    let fatPercent = 0.25;

    if (objective === 'emagrecer') {
      proteinPerKg = 2.2;
      fatPercent = 0.2;
    } else if (objective === 'ganhar_massa') {
      proteinPerKg = 1.8;
      fatPercent = 0.25;
    }

    const protein = Math.round(weight * proteinPerKg);
    const fats = Math.round((calories * fatPercent) / 9);
    const carbs = Math.round((calories - (protein * 4) - (fats * 9)) / 4);

    return { protein, carbs, fats };
  },

  generateDietPlan(calories: number, macros: { protein: number, carbs: number, fats: number }, objective: TrainingObjective): Diet {
    const meals: Meal[] = [
      {
        name: 'Café da Manhã',
        time: '08:00',
        description: objective === 'emagrecer' 
          ? 'Ovos mexidos (2 unid), 1 fatia de pão integral e café sem açúcar.' 
          : 'Ovos mexidos (3 unid), 2 fatias de pão integral, 1 fruta e café.'
      },
      {
        name: 'Lanche da Manhã',
        time: '10:30',
        description: '1 Fruta (Maçã ou Banana) + 15g de Mix de Castanhas.'
      },
      {
        name: 'Almoço',
        time: '13:00',
        description: `150g de Proteína (Frango/Peixe), ${objective === 'emagrecer' ? '100g' : '200g'} de Carboidrato (Arroz/Batata), Vegetais à vontade e 1 colher de azeite.`
      },
      {
        name: 'Lanche da Tarde',
        time: '16:00',
        description: 'Iogurte natural desnatado + 30g de Aveia + 1 scoop de Whey (opcional).'
      },
      {
        name: 'Jantar',
        time: '20:00',
        description: `150g de Proteína (Carne magra/Frango), ${objective === 'emagrecer' ? '50g' : '150g'} de Carboidrato (Batata Doce/Abóbora) e Salada verde.`
      }
    ];

    return {
      id: 'generated',
      userId: '',
      name: 'Plano Alimentar Inteligente',
      meals,
      observations: 'Beba pelo menos 35ml de água por kg de peso corporal. Este plano é uma sugestão baseada em cálculos matemáticos e não substitui a orientação de um nutricionista.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
};
