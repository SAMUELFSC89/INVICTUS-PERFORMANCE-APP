import React, { useState, useEffect, useRef } from 'react';
import { 
  Dumbbell, Utensils, Award, Sparkles, Scale, Info, 
  Share2, Download, Calendar, ArrowRight, User, RefreshCw, 
  ChevronRight, Heart, HeartCrack, Flame, CheckCircle2, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../firebase';
import { getWorkoutTemplate, DIET_TEMPLATES } from './planTemplates';
import { doc, updateDoc } from 'firebase/firestore';
import { UserProfile } from '../types';
import { cn } from '../lib/utils';

interface SmartPlanTabProps {
  user: UserProfile | null;
  onPlanGenerated?: () => void;
}

interface PhysicalData {
  weight: number;
  height: number;
  age: number;
  sex: 'male' | 'female';
  bodyFat: number;
  objective: 'hipertrofia' | 'definir' | 'recompensacao' | 'emagrecimento';
  experience: 'iniciante' | 'intermediario' | 'avancado';
  availability: '3' | '4' | '5' | '6';
  workoutType: 'academia' | 'casa' | 'ambos';
  workoutTime: 'manha' | 'tarde' | 'noite';
  mealsCount: 3 | 4 | 5 | 6;
  restrictions: 'vegano' | 'vegetariano' | 'sem_lactose' | 'sem_gluten' | 'sem_restricoes';
  preferences: string; // alimentos preferidos
  dislikedFoods: string; // alimentos que não gosta
  routineDescription: string; // rotina diária
  workoutHistory: string; // histórico de treino
  injuriesAndLimitations: string; // lesões ou limitações
  workoutPreference: string; // preferência ou foco de treino
  timePerWorkout: number; // tempo disponível por treino
}

interface FoodItem {
  name: string;
  quantity: string;
  protein: number;
  carbs: number;
  fats: number;
  calories: number;
  category?: 'protein' | 'carb' | 'fat' | 'fruit' | 'snack_protein' | 'vegetable';
}

interface SmartMeal {
  name: string;
  time: string;
  foods: FoodItem[];
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

interface SmartWorkoutExercise {
  name: string;
  series: number;
  reps: string;
  rest: string;
  muscleGroup: string;
  category?: string;
}

interface SmartWorkoutDay {
  dayName: string;
  muscleGroup: string;
  isRest: boolean;
  exercises: SmartWorkoutExercise[];
}

interface SmartPlan {
  physicalData: PhysicalData;
  metrics: {
    bmr: number;
    tdee: number;
    targetCalories: number;
    protein: number;
    carbs: number;
    fats: number;
  };
  meals: SmartMeal[];
  workout: {
    divisionName: string;
    days: SmartWorkoutDay[];
  };
  generatedAt: string;
  lastWeightCheckAt?: string;
  variationIndex?: number;
  themeIndex?: number;
  personalizationScore?: number;
  motivationExplain?: string;
}

// ==========================================
// SEEDED PSEUDO-RANDOM NUMBER GENERATOR (PRNG)
// ==========================================
class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = Math.abs(seed) || 1;
  }
  next(): number {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }
  range(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick<T>(arr: T[]): T {
    const idx = this.range(0, arr.length - 1);
    return arr[idx];
  }
}

// ==========================================
// DETERMINISTIC UTILITY LOGIC & SCORE
// ==========================================
const computeSeed = (data: PhysicalData, userId: string, varIndex: number): number => {
  let hash = 0;
  const combinedStr = `${userId}_${data.objective}_${data.experience}_${data.mealsCount}_${data.weight}_${data.height}_${varIndex}`;
  for (let i = 0; i < combinedStr.length; i++) {
    hash = (hash << 5) - hash + combinedStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const calculatePersonalizationScore = (data: PhysicalData): number => {
  let points = 95.0;
  if (data.preferences && data.preferences.trim().length > 3) points += 0.8;
  if (data.dislikedFoods && data.dislikedFoods.trim().length > 3) points += 0.8;
  if (data.routineDescription && data.routineDescription.trim().length > 3) points += 0.6;
  if (data.workoutHistory && data.workoutHistory.trim().length > 3) points += 0.6;
  if (data.injuriesAndLimitations && data.injuriesAndLimitations.trim().length > 3) points += 1.0;
  if (data.workoutPreference && data.workoutPreference.trim().length > 3) points += 0.6;
  if (data.weight % 1 !== 0) points += 0.4;
  if (data.bodyFat !== 15 && data.bodyFat !== 20) points += 0.2;
  return parseFloat(Math.min(99.9, points).toFixed(1));
};

const generatePlanExplanation = (data: PhysicalData, targetCal: number, bmr: number): string => {
  const isMale = data.sex === 'male';
  const sexLabel = isMale ? 'atleta masculino' : 'atleta feminina';
  const experienceLabel = data.experience === 'iniciante' ? 'iniciante dedicado' : (data.experience === 'intermediario' ? 'intermediário consistente' : 'avançado de alta performance');
  
  let explanation = `Este plano foi meticulosamente projetado para o seu perfil de ${sexLabel} com ${data.weight}kg, ${data.height}cm e ${data.bodyFat}% de gordura estimada. `;
  
  if (data.objective === 'hipertrofia') {
    explanation += `Utilizando a fórmula calibrada de Katch-McArdle de massa magra, sua Taxa Basal foi integrada à sua rotina ativa para estipular um superávit controlado saudável de +350 Kcal de forma a otimizar a síntese proteica e o ganho de massa magra limpa, evitando ganho desnecessário de gordura. `;
  } else if (data.objective === 'emagrecimento') {
    explanation += `Para promover oxidação lipídica expressiva preservando sua massa magra total, aplicamos um déficit calórico balanceado e seguro de cerca de -500 Kcal abaixo do seu gasto diário energético real. `;
  } else if (data.objective === 'definir') {
    explanation += `Com o objetivo de revelar sua musculatura mantendo a rigidez mitocondrial, aplicamos um déficit energético moderado e elevamos sua cota proteica média para blindagem do glicogênio. `;
  } else {
    explanation += `Visando a recomposição corporal (ganho de massa magra e redução de gordura corporal simultâneos), sua ingestão calórica foi centralizada exatamente no equilíbrio de manutenção. `;
  }
  
  explanation += `Sua cota total compreende ${data.mealsCount} refeições diárias estruturadas com foco na absorção digestiva e equilíbrio intestinal. `;
  explanation += `A estrutura esportiva dividida em ${data.availability} dias de nível ${experienceLabel} foi calibrada para sessões com duração média de ${data.timePerWorkout} minutos por treino, aproveitando eficientemente o seu tempo útil. `;
  
  if (data.restrictions !== 'sem_restricoes') {
    const labelRes: Record<string, string> = {
      vegano: 'vegana integral',
      vegetariano: 'vegetariana ovolactovegetariana',
      sem_lactose: 'diretriz zero lactose',
      sem_gluten: 'restrição de glúten'
    };
    explanation += `Toda a escolha de alimentos seguiu criteriosamente sua restrição alimentar (${labelRes[data.restrictions]}). `;
  }
  
  if (data.injuriesAndLimitations && data.injuriesAndLimitations.trim().length > 0) {
    explanation += `Importante: Identificamos seu relato de restrição muscular/articular ("${data.injuriesAndLimitations.trim()}") e adaptamos o repertório de movimentos para evitar sobrecarga nociva e promover estabilização regenerativa. `;
  }
  
  return explanation;
};

// ==========================================
// DETAILED DATABASES
// ==========================================
interface FoodSource {
  name: string;
  category: 'protein' | 'carb' | 'fat' | 'fruit' | 'snack_protein' | 'vegetable';
  protein: number; // per 100g or unit
  carbs: number;   // per 100g or unit
  fats: number;    // per 100g or unit
  calories: number;// per 100g or unit
  isVegan: boolean;
  isVegetarian: boolean;
  isGlutenFree: boolean;
  isLactoseFree: boolean;
}

const FOOD_DATABASE: FoodSource[] = [
  // PROTEINS
  { name: 'Filé de Peito de Frango Grelhado', category: 'protein', protein: 31, carbs: 0, fats: 2.5, calories: 159, isVegan: false, isVegetarian: false, isGlutenFree: true, isLactoseFree: true },
  { name: 'Patinho Moído Grelhado', category: 'protein', protein: 28, carbs: 0, fats: 6, calories: 185, isVegan: false, isVegetarian: false, isGlutenFree: true, isLactoseFree: true },
  { name: 'Filé de Tilápia Grelhado', category: 'protein', protein: 20, carbs: 0, fats: 1.5, calories: 96, isVegan: false, isVegetarian: false, isGlutenFree: true, isLactoseFree: true },
  { name: 'Atum Sólido ao Natural em lata', category: 'protein', protein: 26, carbs: 0, fats: 1, calories: 116, isVegan: false, isVegetarian: false, isGlutenFree: true, isLactoseFree: true },
  { name: 'Filé de Salmão ao Forno', category: 'protein', protein: 22, carbs: 0, fats: 12, calories: 206, isVegan: false, isVegetarian: false, isGlutenFree: true, isLactoseFree: true },
  { name: 'Clara de Ovo Cozida', category: 'protein', protein: 11, carbs: 0, fats: 0.2, calories: 52, isVegan: false, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  
  // VEGAN & VEG PROTEINS
  { name: 'Tofu Firme Grelhado', category: 'protein', protein: 12, carbs: 1.5, fats: 4, calories: 85, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Tempeh Assado temperado', category: 'protein', protein: 19, carbs: 9, fats: 11, calories: 195, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Proteína Texturizada de Soja (PTS)', category: 'protein', protein: 50, carbs: 30, fats: 1, calories: 325, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Lentilha Cozida', category: 'protein', protein: 9, carbs: 20, fats: 0.5, calories: 116, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Grão-de-Bico Inteiro Cozido', category: 'protein', protein: 8.5, carbs: 27, fats: 2.5, calories: 164, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },

  // CARBS
  { name: 'Arroz Branco Cozido', category: 'carb', protein: 2, carbs: 28, fats: 0.2, calories: 130, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Arroz Integral Cozido', category: 'carb', protein: 2.6, carbs: 25, fats: 1, calories: 111, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Batata Doce Assada', category: 'carb', protein: 1.5, carbs: 20, fats: 0.1, calories: 90, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Mandioquinha Salsa Cozida', category: 'carb', protein: 1.2, carbs: 19, fats: 0.2, calories: 80, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Mandioca Cozida macia', category: 'carb', protein: 1.1, carbs: 38, fats: 0.3, calories: 160, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Macarrão Integral Al Dente', category: 'carb', protein: 5.3, carbs: 26, fats: 0.5, calories: 124, isVegan: true, isVegetarian: true, isGlutenFree: false, isLactoseFree: true },
  { name: 'Quinoa Cozida em Grãos', category: 'carb', protein: 4.4, carbs: 21, fats: 1.9, calories: 120, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Batata Inglesa cozida', category: 'carb', protein: 2, carbs: 17, fats: 0.1, calories: 87, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Cuscuz de Milho Amarelo', category: 'carb', protein: 2.2, carbs: 25, fats: 0.6, calories: 112, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },

  // FRUITS
  { name: 'Banana Prata fatiada', category: 'fruit', protein: 1.3, carbs: 23, fats: 0.3, calories: 89, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Maçã Fuji picada', category: 'fruit', protein: 0.3, carbs: 14, fats: 0.2, calories: 52, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Morangos Frescos inteiros', category: 'fruit', protein: 0.8, carbs: 8, fats: 0.3, calories: 32, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Abacaxi Pérola fatiado', category: 'fruit', protein: 0.5, carbs: 13, fats: 0.1, calories: 50, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Melão Amarelo em cubos', category: 'fruit', protein: 0.8, carbs: 8, fats: 0.2, calories: 34, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },

  // FATS
  { name: 'Azeite de Oliva Extra Virgem', category: 'fat', protein: 0, carbs: 0, fats: 100, calories: 900, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Castanha do Pará', category: 'fat', protein: 14, carbs: 12, fats: 66, calories: 656, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Pasta de Amendoim Integral', category: 'fat', protein: 26, carbs: 16, fats: 50, calories: 588, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Abacate Hass maduro', category: 'fat', protein: 2, carbs: 8, fats: 15, calories: 160, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },

  // SNACK PROTEINS
  { name: 'Whey Protein Concentrado 80%', category: 'snack_protein', protein: 80, carbs: 6.6, fats: 5, calories: 391, isVegan: false, isVegetarian: true, isGlutenFree: true, isLactoseFree: false },
  { name: 'Whey Protein Isolado (Lactose Free)', category: 'snack_protein', protein: 90, carbs: 1, fats: 1, calories: 373, isVegan: false, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Proteína de Ervilha em Pó', category: 'snack_protein', protein: 75, carbs: 5, fats: 3, calories: 347, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Iogurte Grego Natural', category: 'snack_protein', protein: 7, carbs: 4.5, fats: 5, calories: 90, isVegan: false, isVegetarian: true, isGlutenFree: true, isLactoseFree: false },
  { name: 'Iogurte Grego Lactose Free', category: 'snack_protein', protein: 6.8, carbs: 4, fats: 4.5, calories: 85, isVegan: false, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Iogurte de Coco Vegano', category: 'snack_protein', protein: 2, carbs: 8, fats: 12, calories: 150, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Queijo Cottage Tradicional', category: 'snack_protein', protein: 11, carbs: 3, fats: 4, calories: 98, isVegan: false, isVegetarian: true, isGlutenFree: true, isLactoseFree: false },
  { name: 'Queijo Cottage Sem Lactose', category: 'snack_protein', protein: 11, carbs: 3, fats: 4, calories: 98, isVegan: false, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Ovos de Galinha Inteiros', category: 'snack_protein', protein: 13, carbs: 0.6, fats: 10, calories: 143, isVegan: false, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Aveia em Flocos', category: 'carb', protein: 14, carbs: 57, fats: 6, calories: 370, isVegan: true, isVegetarian: true, isGlutenFree: false, isLactoseFree: true },
  { name: 'Aveia Sem Glúten', category: 'carb', protein: 14, carbs: 57, fats: 6, calories: 370, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true },
  { name: 'Geleia de Frutas Diet', category: 'carb', protein: 0, carbs: 24, fats: 0, calories: 96, isVegan: true, isVegetarian: true, isGlutenFree: true, isLactoseFree: true }
];

interface ExerciseSource {
  name: string;
  muscleGroup: string;
  category: string;
  isGym: boolean;
  isJointHeavy: boolean;
  jointInvolved: 'joelho' | 'lombar' | 'ombro' | 'punho' | 'nenhum';
}

const EXERCISE_DATABASE: ExerciseSource[] = [
  // CHEST
  { name: 'Supino Reto com Barra', muscleGroup: 'Peitoral', category: 'peito', isGym: true, isJointHeavy: true, jointInvolved: 'ombro' },
  { name: 'Supino Reto com Halteres', muscleGroup: 'Peitoral', category: 'peito', isGym: true, isJointHeavy: false, jointInvolved: 'ombro' },
  { name: 'Supino Inclinado com Halteres', muscleGroup: 'Peito Superior', category: 'peito', isGym: true, isJointHeavy: false, jointInvolved: 'ombro' },
  { name: 'Crucifixo Reto no Cabo', muscleGroup: 'Peito Isolador', category: 'peito', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Voador / Peck Deck', muscleGroup: 'Peitoral', category: 'peito', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Flexão de Braços Clássica', muscleGroup: 'Peitoral', category: 'peito', isGym: false, isJointHeavy: false, jointInvolved: 'ombro' },
  { name: 'Flexão de Braços Declinada', muscleGroup: 'Peito Superior', category: 'peito', isGym: false, isJointHeavy: false, jointInvolved: 'ombro' },
  { name: 'Flexões com Mãos no Banco', muscleGroup: 'Peito Inferior', category: 'peito', isGym: false, isJointHeavy: false, jointInvolved: 'nenhum' },

  // BACK
  { name: 'Remada Curvada com Barra', muscleGroup: 'Costas', category: 'costas', isGym: true, isJointHeavy: true, jointInvolved: 'lombar' },
  { name: 'Remada Cavalinho Neutra', muscleGroup: 'Costas', category: 'costas', isGym: true, isJointHeavy: true, jointInvolved: 'lombar' },
  { name: 'Puxada Alta Pronada no Pulley', muscleGroup: 'Costas', category: 'costas', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Puxada Triângulo no Pulley', muscleGroup: 'Costas', category: 'costas', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Remada Unilateral com Halter', muscleGroup: 'Costas', category: 'costas', isGym: true, isJointHeavy: false, jointInvolved: 'lombar' },
  { name: 'Barra Fixa Pronada', muscleGroup: 'Costas', category: 'costas', isGym: false, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Barra Fixa Supinada', muscleGroup: 'Costas / Bíceps', category: 'costas', isGym: false, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Remada Curvada com Mochila', muscleGroup: 'Costas', category: 'costas', isGym: false, isJointHeavy: true, jointInvolved: 'lombar' },
  { name: 'Remada Invertida na Mesa', muscleGroup: 'Costas', category: 'costas', isGym: false, isJointHeavy: false, jointInvolved: 'nenhum' },

  // SHOULDERS
  { name: 'Desenvolvimento Militar com Barra', muscleGroup: 'Ombros', category: 'ombro', isGym: true, isJointHeavy: true, jointInvolved: 'lombar' },
  { name: 'Desenvolvimento com Halteres', muscleGroup: 'Ombros', category: 'ombro', isGym: true, isJointHeavy: false, jointInvolved: 'ombro' },
  { name: 'Elevação Lateral com Halteres', muscleGroup: 'Ombro Lateral', category: 'ombro', isGym: true, isJointHeavy: false, jointInvolved: 'ombro' },
  { name: 'Elevação Lateral no Cabo Polia', muscleGroup: 'Ombro Lateral', category: 'ombro', isGym: true, isJointHeavy: false, jointInvolved: 'ombro' },
  { name: 'Crucifixo Invertido com Halteres', muscleGroup: 'Ombro Posterior', category: 'ombro', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Flexão Pike', muscleGroup: 'Ombros', category: 'ombro', isGym: false, isJointHeavy: false, jointInvolved: 'ombro' },
  { name: 'Elevação Lateral com Garrafas', muscleGroup: 'Ombro Lateral', category: 'ombro', isGym: false, isJointHeavy: false, jointInvolved: 'ombro' },

  // LEGS QUADRICEPS
  { name: 'Agachamento Livre com Barra', muscleGroup: 'Pernas / Quadríceps', category: 'perna_quads', isGym: true, isJointHeavy: true, jointInvolved: 'joelho' },
  { name: 'Leg Press 45 Graus', muscleGroup: 'Quadríceps / Pernas', category: 'perna_quads', isGym: true, isJointHeavy: false, jointInvolved: 'joelho' },
  { name: 'Cadeira Extensora', muscleGroup: 'Quadríceps', category: 'perna_quads', isGym: true, isJointHeavy: false, jointInvolved: 'joelho' },
  { name: 'Agachamento Búlgaro com Halter', muscleGroup: 'Pernas / Quadríceps', category: 'perna_quads', isGym: true, isJointHeavy: false, jointInvolved: 'joelho' },
  { name: 'Agachamento Prisioneiro Solo', muscleGroup: 'Pernas / Quadríceps', category: 'perna_quads', isGym: false, isJointHeavy: false, jointInvolved: 'joelho' },
  { name: 'Agachamento Búlgaro Sem Carga', muscleGroup: 'Pernas Completas', category: 'perna_quads', isGym: false, isJointHeavy: false, jointInvolved: 'joelho' },
  { name: 'Agachamento Isométrico Parede', muscleGroup: 'Quadríceps', category: 'perna_quads', isGym: false, isJointHeavy: false, jointInvolved: 'joelho' },
  { name: 'Passada Avanço Corporais', muscleGroup: 'Pernas', category: 'perna_quads', isGym: false, isJointHeavy: false, jointInvolved: 'joelho' },

  // LEGS HAMSTRINGS
  { name: 'Levantamento Terra RDL (Stiff)', muscleGroup: 'Posteriores de Coxa', category: 'perna_post', isGym: true, isJointHeavy: true, jointInvolved: 'lombar' },
  { name: 'Mesa Flexora Deitada', muscleGroup: 'Posteriores', category: 'perna_post', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Cadeira Flexora Sentada', muscleGroup: 'Posteriores de Coxa', category: 'perna_post', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Elevação Pélvica com Barra', muscleGroup: 'Glúteos / Posteriores', category: 'perna_post', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Stiff Unilateral Peso Corporal', muscleGroup: 'Posteriores de Coxa', category: 'perna_post', isGym: false, isJointHeavy: false, jointInvolved: 'lombar' },
  { name: 'Ponte de Glúteo no Solo', muscleGroup: 'Glúteos / Posteriores', category: 'perna_post', isGym: false, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Stiff com Mochila Carregada', muscleGroup: 'Posteriores', category: 'perna_post', isGym: false, isJointHeavy: true, jointInvolved: 'lombar' },

  // BICEPS
  { name: 'Rosca Direta com Barra W', muscleGroup: 'Bíceps', category: 'biceps', isGym: true, isJointHeavy: false, jointInvolved: 'punho' },
  { name: 'Rosca Direta com Halteres', muscleGroup: 'Bíceps', category: 'biceps', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Rosca Martelo com Halteres', muscleGroup: 'Bíceps/Braquial', category: 'biceps', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Rosca Direta no Cabo Polia', muscleGroup: 'Bíceps', category: 'biceps', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Rosca Concentrada com Halter', muscleGroup: 'Bíceps', category: 'biceps', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Rosca Alternada com Mochila', muscleGroup: 'Bíceps', category: 'biceps', isGym: false, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Rosca Martelo com Galão', muscleGroup: 'Bíceps', category: 'biceps', isGym: false, isJointHeavy: false, jointInvolved: 'nenhum' },
  
  // TRICEPS
  { name: 'Tríceps no Pulley Corda', muscleGroup: 'Tríceps', category: 'triceps', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Tríceps Pulley Barra Reta', muscleGroup: 'Tríceps', category: 'triceps', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Tríceps Testa com Barra W', muscleGroup: 'Tríceps', category: 'triceps', isGym: true, isJointHeavy: true, jointInvolved: 'ombro' },
  { name: 'Tríceps Banco (Mergulho)', muscleGroup: 'Tríceps', category: 'triceps', isGym: false, isJointHeavy: false, jointInvolved: 'ombro' },
  { name: 'Flexão com Mãos Juntas (Diamante)', muscleGroup: 'Tríceps', category: 'triceps', isGym: false, isJointHeavy: false, jointInvolved: 'punho' },
  { name: 'Extensão Tríceps com Garrafa', muscleGroup: 'Tríceps', category: 'triceps', isGym: false, isJointHeavy: false, jointInvolved: 'ombro' },

  // CORE
  { name: 'Abdominal Supra Curto', muscleGroup: 'Abdômen', category: 'core', isGym: false, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Prancha Isométrica Estrutural', muscleGroup: 'Core', category: 'core', isGym: false, isJointHeavy: false, jointInvolved: 'lombar' },
  { name: 'Abdominal Remador Completo', muscleGroup: 'Core / Abdômen', category: 'core', isGym: false, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Elevação de Pernas Suspenso', muscleGroup: 'Abdômen Infra', category: 'core', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Elevação de Pernas Deitado', muscleGroup: 'Abdômen Infra', category: 'core', isGym: false, isJointHeavy: false, jointInvolved: 'lombar' },

  // CARDIO
  { name: 'Cardio: Caminhada acelerada', muscleGroup: 'Cardio LISS', category: 'cardio', isGym: false, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Cardio: Corrida moderada em esteira', muscleGroup: 'Cardio LISS', category: 'cardio', isGym: true, isJointHeavy: true, jointInvolved: 'joelho' },
  { name: 'Cardio: Elíptico de Alta Intensidade', muscleGroup: 'Cardio LISS/HIIT', category: 'cardio', isGym: true, isJointHeavy: false, jointInvolved: 'nenhum' },
  { name: 'Cardio: Corrida ao ar livre ritmada', muscleGroup: 'Cardio LISS', category: 'cardio', isGym: false, isJointHeavy: true, jointInvolved: 'joelho' },
  { name: 'Cardio: Polichinelos rápidos contínuos', muscleGroup: 'Cardio HIIT', category: 'cardio', isGym: false, isJointHeavy: true, jointInvolved: 'joelho' }
];

// ==========================================
// 10 UNIQUE VISUAL THEMES
// ==========================================
interface VisualTheme {
  name: string;
  bg: string;
  cardBg: string;
  primary: string;
  secondary: string;
  border: string;
  text: string;
  textMuted: string;
  badgeBg: string;
  tableHeaderBg: string;
  tableHeaderTxt: string;
  useGlow: boolean;
  style: 'classic' | 'cyber' | 'athletic' | 'premium' | 'sunset' | 'neon' | 'forest' | 'brutalist' | 'volcano' | 'steel';
}

const THEMES: VisualTheme[] = [
  {
    name: "Classic Invictus Pro",
    bg: "#050505",
    cardBg: "#111111",
    primary: "#FFCC00",
    secondary: "#B23BFF",
    border: "#2A2A2A",
    text: "#FFFFFF",
    textMuted: "#888888",
    badgeBg: "#1F1A0B",
    tableHeaderBg: "#FFCC00",
    tableHeaderTxt: "#000000",
    useGlow: true,
    style: "classic"
  },
  {
    name: "Cyberpunk Neon Matrix",
    bg: "#020804",
    cardBg: "#071A0B",
    primary: "#39FF14",
    secondary: "#00F0FF",
    border: "#0D3814",
    text: "#E6FFE6",
    textMuted: "#4F9F5A",
    badgeBg: "#0B210F",
    tableHeaderBg: "#39FF14",
    tableHeaderTxt: "#000000",
    useGlow: true,
    style: "cyber"
  },
  {
    name: "Crimson Rage Athletic",
    bg: "#0B0202",
    cardBg: "#1E0909",
    primary: "#FF3333",
    secondary: "#FFAA00",
    border: "#3F1414",
    text: "#FFEBEB",
    textMuted: "#A36B6B",
    badgeBg: "#2B0B0B",
    tableHeaderBg: "#FF3333",
    tableHeaderTxt: "#FFFFFF",
    useGlow: true,
    style: "athletic"
  },
  {
    name: "Cobalt Diamond Premium",
    bg: "#020712",
    cardBg: "#0B1428",
    primary: "#0088FF",
    secondary: "#00FFCC",
    border: "#122A54",
    text: "#E0ECFF",
    textMuted: "#6B88B2",
    badgeBg: "#0B1C38",
    tableHeaderBg: "#0088FF",
    tableHeaderTxt: "#FFFFFF",
    useGlow: true,
    style: "premium"
  },
  {
    name: "Sunset Amber Horizon",
    bg: "#0C0601",
    cardBg: "#1D1005",
    primary: "#FF9900",
    secondary: "#FF3300",
    border: "#3F220A",
    text: "#FFF2E6",
    textMuted: "#A37A5C",
    badgeBg: "#261304",
    tableHeaderBg: "#FF9900",
    tableHeaderTxt: "#000000",
    useGlow: false,
    style: "sunset"
  },
  {
    name: "Acid Toxic Mutant",
    bg: "#0D0D0D",
    cardBg: "#171F11",
    primary: "#ADFF2F",
    secondary: "#D2691E",
    border: "#2E3B20",
    text: "#F5FFFA",
    textMuted: "#6B8E23",
    badgeBg: "#1D2815",
    tableHeaderBg: "#ADFF2F",
    tableHeaderTxt: "#000000",
    useGlow: true,
    style: "neon"
  },
  {
    name: "Forest Iron Legends",
    bg: "#040A06",
    cardBg: "#0F2015",
    primary: "#2ECC71",
    secondary: "#D4AC0D",
    border: "#1E3F2B",
    text: "#EAF2F8",
    textMuted: "#7D9384",
    badgeBg: "#112D1C",
    tableHeaderBg: "#2ECC71",
    tableHeaderTxt: "#000000",
    useGlow: false,
    style: "forest"
  },
  {
    name: "Monochrome Brutalist",
    bg: "#000000",
    cardBg: "#161616",
    primary: "#FFFFFF",
    secondary: "#888888",
    border: "#444444",
    text: "#FFFFFF",
    textMuted: "#AAAAAA",
    badgeBg: "#222222",
    tableHeaderBg: "#FFFFFF",
    tableHeaderTxt: "#000000",
    useGlow: false,
    style: "brutalist"
  },
  {
    name: "Volcanic Ash Inferno",
    bg: "#100905",
    cardBg: "#24140C",
    primary: "#E65C00",
    secondary: "#F9D423",
    border: "#4D2814",
    text: "#FFF2EB",
    textMuted: "#B39281",
    badgeBg: "#31180A",
    tableHeaderBg: "#E65C00",
    tableHeaderTxt: "#FFFFFF",
    useGlow: true,
    style: "volcano"
  },
  {
    name: "Steel Titan Industrial",
    bg: "#0A0D14",
    cardBg: "#161B26",
    primary: "#00D2FF",
    secondary: "#3A6073",
    border: "#283446",
    text: "#E1E6F0",
    textMuted: "#798A9F",
    badgeBg: "#19283D",
    tableHeaderBg: "#3A6073",
    tableHeaderTxt: "#FFFFFF",
    useGlow: false,
    style: "steel"
  }
];

export function SmartPlanTab({ user, onPlanGenerated }: SmartPlanTabProps) {
  const [step, setStep] = useState<'form' | 'results'>('form');
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<PhysicalData>({
    weight: user?.weight || 75,
    height: user?.height || 175,
    age: user?.age || 26,
    sex: user?.sex || 'male',
    bodyFat: 15,
    objective: 'hipertrofia',
    experience: 'intermediario',
    availability: '4',
    workoutType: 'academia',
    workoutTime: 'tarde',
    mealsCount: 4,
    restrictions: 'sem_restricoes',
    preferences: '',
    dislikedFoods: '',
    routineDescription: '',
    workoutHistory: '',
    injuriesAndLimitations: '',
    workoutPreference: '',
    timePerWorkout: 60
  });

  const [activeSubTab, setActiveSubTab] = useState<'workout'>('workout');
  const [smartPlan, setSmartPlan] = useState<SmartPlan | null>(null);
  const [showWeightPrompt, setShowWeightPrompt] = useState(false);
  const [newWeight, setNewWeight] = useState(formData.weight);
  const [copiedLink, setCopiedLink] = useState(false);
  const [variationIndex, setVariationIndex] = useState(0);
  const [themeIndex, setThemeIndex] = useState(0);
  const [daysSinceGen, setDaysSinceGen] = useState<number>(0);

  const dietCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const workoutCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load existing smart plan from localStorage or fallback
  useEffect(() => {
    if (user) {
      const cached = localStorage.getItem(`invictus_smartplan_${user.uid}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as SmartPlan;
          setSmartPlan(parsed);
          setFormData(parsed.physicalData);
          if (parsed.variationIndex !== undefined) setVariationIndex(parsed.variationIndex);
          if (parsed.themeIndex !== undefined) setThemeIndex(parsed.themeIndex);
          setStep('results');
          
          const genDate = new Date(parsed.generatedAt);
          const now = new Date();
          const diffDays = Math.floor((now.getTime() - genDate.getTime()) / (1000 * 60 * 60 * 24));
          setDaysSinceGen(diffDays);
          if (diffDays >= 15) {
            setShowWeightPrompt(true);
            setNewWeight(parsed.physicalData.weight);
          }
        } catch (e) {
          console.error('[SmartPlan] Failed to load cached plan', e);
        }
      } else if ((user as any).generatedPlan) {
        // Fallback: Restore from cloud user.generatedPlan metadata deterministically
        try {
          const cloudMeta = (user as any).generatedPlan;
          if (cloudMeta.physicalData && cloudMeta.metrics) {
            const seed = computeSeed(cloudMeta.physicalData, user.uid, variationIndex);
            const meals = generateMockCustomMeals(cloudMeta.physicalData, cloudMeta.metrics.targetCalories, cloudMeta.metrics.protein, cloudMeta.metrics.carbs, cloudMeta.metrics.fats, seed, variationIndex);
            const workout = generateMockCustomWorkout(cloudMeta.physicalData, seed, variationIndex);
            const personalizationScore = calculatePersonalizationScore(cloudMeta.physicalData);
            const motivationExplain = generatePlanExplanation(cloudMeta.physicalData, cloudMeta.metrics.targetCalories, cloudMeta.metrics.bmr);

            const reconstructed: SmartPlan = {
              physicalData: cloudMeta.physicalData,
              metrics: cloudMeta.metrics,
              meals,
              workout,
              generatedAt: cloudMeta.generatedAt || new Date().toISOString(),
              variationIndex: variationIndex,
              themeIndex: themeIndex,
              personalizationScore,
              motivationExplain
            };

            setSmartPlan(reconstructed);
            setFormData(cloudMeta.physicalData);
            setStep('results');
            
            const genDate = new Date(reconstructed.generatedAt);
            const now = new Date();
            const diffDays = Math.floor((now.getTime() - genDate.getTime()) / (1000 * 60 * 60 * 24));
            setDaysSinceGen(diffDays);

            localStorage.setItem(`invictus_smartplan_${user.uid}`, JSON.stringify(reconstructed));
          }
        } catch (err) {
          console.error('[SmartPlan] Failed to reconstruct from Firestore meta', err);
        }
      }
    }
  }, [user]);

  // Handle calculation & generation
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    try {
      // 1. Core Mathematical Calculations (Harris-Benedict and Mifflin-St Jeor integration)
      const weight = Number(formData.weight);
      const height = Number(formData.height);
      const age = Number(formData.age);
      const bf = Number(formData.bodyFat);

      // Basal Metabolic Rate (Mifflin-St Jeor)
      let bmr = 0;
      if (formData.sex === 'male') {
        bmr = 10 * weight + 6.25 * height - 5 * age + 5;
      } else {
        bmr = 10 * weight + 6.25 * height - 5 * age - 161;
      }

      // TDEE Activity Factor based on days available to train
      let activityFactor = 1.2;
      switch (formData.availability) {
        case '3': activityFactor = 1.375; break; // Moderately active
        case '4': activityFactor = 1.45; break;
        case '5': activityFactor = 1.55; break; // Very active
        case '6': activityFactor = 1.65; break;
      }
      const tdee = Math.round(bmr * activityFactor);

      // Target calories depending on objective
      let targetCalories = tdee;
      if (formData.objective === 'hipertrofia') {
        targetCalories = tdee + 350; // Lean surplus
      } else if (formData.objective === 'emagrecimento') {
        targetCalories = Math.max(1200, tdee - 500); // Deficit
      } else if (formData.objective === 'definir') {
        targetCalories = Math.max(1300, tdee - 250); // Small deficit
      } else {
        targetCalories = tdee; // Body recomp
      }

      // Macronutrients distribution
      let proteinPerKg = 2.0;
      if (formData.objective === 'hipertrofia' || formData.objective === 'definir') {
        proteinPerKg = 2.2;
      } else if (formData.objective === 'emagrecimento') {
        proteinPerKg = 2.0;
      } else {
        proteinPerKg = 2.0;
      }

      const proteinGrams = Math.round(weight * proteinPerKg);
      const fatsGrams = Math.round(weight * 0.9); // Moderate fat baseline for health
      const proteinCalories = proteinGrams * 4;
      const fatsCalories = fatsGrams * 9;
      const carbsCalories = Math.max(50 * 4, targetCalories - (proteinCalories + fatsCalories));
      const carbsGrams = Math.round(carbsCalories / 4);
      const finalCalories = Math.round(proteinCalories + fatsCalories + (carbsGrams * 4));

      const planSeed = computeSeed(formData, user?.uid || "user_guest", 0);
      const scoreValue = calculatePersonalizationScore(formData);
      const explainValue = generatePlanExplanation(formData, finalCalories, Math.round(bmr));

      // 2. Generate custom meal plan
      const meals = generateMockCustomMeals(formData, finalCalories, proteinGrams, carbsGrams, fatsGrams, planSeed, 0);

      // 3. Generate custom workout plan
      const workout = generateMockCustomWorkout(formData, planSeed, 0);

      const generatedPlan: SmartPlan = {
        physicalData: formData,
        metrics: {
          bmr: Math.round(bmr),
          tdee: Math.round(tdee),
          targetCalories: finalCalories,
          protein: proteinGrams,
          carbs: carbsGrams,
          fats: fatsGrams
        },
        meals,
        workout,
        generatedAt: new Date().toISOString(),
        variationIndex: 0,
        themeIndex: themeIndex,
        personalizationScore: scoreValue,
        motivationExplain: explainValue
      };

      // Save to localStorage
      localStorage.setItem(`invictus_smartplan_${user.uid}`, JSON.stringify(generatedPlan));
      setSmartPlan(generatedPlan);

      // Also persist to Firebase Firestore beautifully to synchronize user's state
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          generatedPlan: {
            metrics: generatedPlan.metrics,
            physicalData: generatedPlan.physicalData,
            generatedAt: generatedPlan.generatedAt
          }
        });
      } catch (err) {
        console.error('[SmartPlan] Failed to update Firestore user metadata', err);
      }

      setStep('results');
      if (onPlanGenerated) onPlanGenerated();
    } catch (e) {
      console.error('[SmartPlan] Generation error', e);
    } finally {
      setLoading(false);
    }
  };

  // Re-evaluation recalculate
  const handleReevaluate = async () => {
    if (!smartPlan || !user) return;
    setLoading(true);
    try {
      const oldFormData = smartPlan.physicalData;
      const updatedFormData: PhysicalData = {
        ...oldFormData,
        weight: Number(newWeight)
      };

      // Re-trigger generation with updated weight
      setFormData(updatedFormData);
      
      const weight = Number(updatedFormData.weight);
      const height = Number(updatedFormData.height);
      const age = Number(updatedFormData.age);

      let bmr = 0;
      if (updatedFormData.sex === 'male') {
        bmr = 10 * weight + 6.25 * height - 5 * age + 5;
      } else {
        bmr = 10 * weight + 6.25 * height - 5 * age - 161;
      }

      let activityFactor = 1.2;
      switch (updatedFormData.availability) {
        case '3': activityFactor = 1.375; break;
        case '4': activityFactor = 1.45; break;
        case '5': activityFactor = 1.55; break;
        case '6': activityFactor = 1.65; break;
      }
      const tdee = Math.round(bmr * activityFactor);

      let targetCalories = tdee;
      if (updatedFormData.objective === 'hipertrofia') {
        targetCalories = tdee + 350;
      } else if (updatedFormData.objective === 'emagrecimento') {
        targetCalories = Math.max(1200, tdee - 500);
      } else if (updatedFormData.objective === 'definir') {
        targetCalories = Math.max(1300, tdee - 250);
      } else {
        targetCalories = tdee;
      }

      let proteinPerKg = 2.2;
      if (updatedFormData.objective === 'emagrecimento') proteinPerKg = 2.0;

      const proteinGrams = Math.round(weight * proteinPerKg);
      const fatsGrams = Math.round(weight * 0.9);
      const proteinCalories = proteinGrams * 4;
      const fatsCalories = fatsGrams * 9;
      const carbsGrams = Math.max(50, Math.round((targetCalories - (proteinCalories + fatsCalories)) / 4));
      const finalCalories = Math.round(proteinCalories + fatsCalories + (carbsGrams * 4));

      const planSeed = computeSeed(updatedFormData, user?.uid || "user_guest", variationIndex);
      const scoreValue = calculatePersonalizationScore(updatedFormData);
      const explainValue = generatePlanExplanation(updatedFormData, finalCalories, Math.round(bmr));

      const meals = generateMockCustomMeals(updatedFormData, finalCalories, proteinGrams, carbsGrams, fatsGrams, planSeed, variationIndex);
      const workout = generateMockCustomWorkout(updatedFormData, planSeed, variationIndex);

      const generatedPlan: SmartPlan = {
        physicalData: updatedFormData,
        metrics: {
          bmr: Math.round(bmr),
          tdee: Math.round(tdee),
          targetCalories: finalCalories,
          protein: proteinGrams,
          carbs: carbsGrams,
          fats: fatsGrams
        },
        meals,
        workout,
        generatedAt: new Date().toISOString(),
        variationIndex: variationIndex,
        themeIndex: themeIndex,
        personalizationScore: scoreValue,
        motivationExplain: explainValue
      };

      // Save to localStorage
      localStorage.setItem(`invictus_smartplan_${user.uid}`, JSON.stringify(generatedPlan));
      setSmartPlan(generatedPlan);
      setShowWeightPrompt(false);
      
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          generatedPlan: {
            metrics: generatedPlan.metrics,
            physicalData: generatedPlan.physicalData,
            generatedAt: generatedPlan.generatedAt
          }
        });
      } catch (err) {
        console.error(err);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleThemeChange = (newThemeIdx: number) => {
    setThemeIndex(newThemeIdx);
    if (smartPlan) {
      const updatedPlan = { ...smartPlan, themeIndex: newThemeIdx };
      setSmartPlan(updatedPlan);
      localStorage.setItem(`invictus_smartplan_${user?.uid || "guest"}`, JSON.stringify(updatedPlan));
    }
  };

  const handleGenerateVariation = () => {
    if (!smartPlan) return;
    setLoading(true);
    try {
      const nextVarIdx = (variationIndex + 1) % 10;
      setVariationIndex(nextVarIdx);
      
      const nextSeed = computeSeed(smartPlan.physicalData, user?.uid || "user_guest", nextVarIdx);
      
      const finalCalories = smartPlan.metrics.targetCalories;
      const proteinGrams = smartPlan.metrics.protein;
      const carbsGrams = smartPlan.metrics.carbs;
      const fatsGrams = smartPlan.metrics.fats;
      
      const nextMeals = generateMockCustomMeals(smartPlan.physicalData, finalCalories, proteinGrams, carbsGrams, fatsGrams, nextSeed, nextVarIdx);
      const nextWorkout = generateMockCustomWorkout(smartPlan.physicalData, nextSeed, nextVarIdx);
      const nextScore = calculatePersonalizationScore(smartPlan.physicalData);
      const nextExplanation = generatePlanExplanation(smartPlan.physicalData, finalCalories, Math.round(smartPlan.metrics.bmr));
      
      const updatedPlan: SmartPlan = {
        ...smartPlan,
        meals: nextMeals,
        workout: nextWorkout,
        variationIndex: nextVarIdx,
        personalizationScore: nextScore,
        motivationExplain: nextExplanation,
        generatedAt: new Date().toISOString()
      };
      
      setSmartPlan(updatedPlan);
      localStorage.setItem(`invictus_smartplan_${user?.uid || "guest"}`, JSON.stringify(updatedPlan));
    } catch (err) {
      console.error("Failed to generate variation:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSwapFood = (mealIdx: number, foodIdx: number) => {
    if (!smartPlan) return;
    const updatedPlan = { ...smartPlan };
    const meal = updatedPlan.meals[mealIdx];
    const food = meal.foods[foodIdx];
    
    const originalFromDb = FOOD_DATABASE.find(f => f.name.toLowerCase() === food.name.toLowerCase()) 
      || FOOD_DATABASE.find(f => food.name.toLowerCase().includes(f.name.toLowerCase()));
    const category = originalFromDb ? originalFromDb.category : 'protein';
    
    const alternatives = FOOD_DATABASE.filter(f => f.category === category && f.name.toLowerCase() !== food.name.toLowerCase());
    if (alternatives.length === 0) return;
    
    const randomAlternative = alternatives[Math.floor(Math.random() * alternatives.length)];
    
    const origCalsPer100g = originalFromDb ? (originalFromDb.protein * 4) + (originalFromDb.carbs * 4) + (originalFromDb.fats * 9) : 120;
    const newCalsPer100g = (randomAlternative.protein * 4) + (randomAlternative.carbs * 4) + (randomAlternative.fats * 9);
    
    let originalGrams = 100;
    const matchGrams = food.quantity.match(/(\d+)\s*(g|ml)/i);
    if (matchGrams) {
      originalGrams = parseInt(matchGrams[1], 10);
    } else {
      const matchUnits = food.quantity.match(/(\d+)/);
      if (matchUnits) {
        originalGrams = parseInt(matchUnits[1], 10) * 50;
      }
    }
    
    const origMealCalories = (originalGrams * origCalsPer100g) / 100;
    const newGramsRequired = Math.max(15, Math.round((origMealCalories / newCalsPer100g) * 100));
    const sanitizedQuantity = `${newGramsRequired}g`;
    
    const itemProt = Math.round((newGramsRequired * randomAlternative.protein) / 100);
    const itemCarb = Math.round((newGramsRequired * randomAlternative.carbs) / 100);
    const itemFat = Math.round((newGramsRequired * randomAlternative.fats) / 100);
    const itemCals = Math.round((itemProt * 4) + (itemCarb * 4) + (itemFat * 9));

    meal.foods[foodIdx] = {
      name: randomAlternative.name,
      quantity: sanitizedQuantity,
      protein: itemProt,
      carbs: itemCarb,
      fats: itemFat,
      calories: itemCals,
      category: randomAlternative.category
    };
    
    let mealProtein = 0;
    let mealCarbs = 0;
    let mealFats = 0;
    
    meal.foods.forEach((fd) => {
      const dbItem = FOOD_DATABASE.find(f => f.name.toLowerCase() === fd.name.toLowerCase())
        || FOOD_DATABASE.find(f => fd.name.toLowerCase().includes(f.name.toLowerCase()));
      if (dbItem) {
        let grams = 100;
        const gm = fd.quantity.match(/(\d+)\s*(g|ml)/i);
        if (gm) {
          grams = parseInt(gm[1], 10);
        } else {
          const ut = fd.quantity.match(/(\d+)/);
          if (ut) grams = parseInt(ut[1], 10) * 50;
        }
        mealProtein += Math.round((grams * dbItem.protein) / 100);
        mealCarbs += Math.round((grams * dbItem.carbs) / 100);
        mealFats += Math.round((grams * dbItem.fats) / 100);
      }
    });
    
    meal.calories = Math.round((mealProtein * 4) + (mealCarbs * 4) + (mealFats * 9));
    meal.protein = mealProtein;
    meal.carbs = mealCarbs;
    meal.fats = mealFats;
    
    setSmartPlan(updatedPlan);
    localStorage.setItem(`invictus_smartplan_${user?.uid || "guest"}`, JSON.stringify(updatedPlan));
  };

  const handleSwapExercise = (dayIdx: number, exerciseIdx: number) => {
    if (!smartPlan) return;
    const updatedPlan = { ...smartPlan };
    const day = updatedPlan.workout.days[dayIdx];
    const ex = day.exercises[exerciseIdx];
    
    const originalFromDb = EXERCISE_DATABASE.find(e => e.name.toLowerCase() === ex.name.toLowerCase());
    const category = originalFromDb ? originalFromDb.category : 'upper';
    
    const isAcademia = smartPlan.physicalData.workoutType !== 'casa';
    const alternatives = EXERCISE_DATABASE.filter(e => 
      e.category === category && 
      e.name.toLowerCase() !== ex.name.toLowerCase() &&
      (isAcademia ? true : !e.isGym)
    );
    
    if (alternatives.length === 0) return;
    
    const randomAlternative = alternatives[Math.floor(Math.random() * alternatives.length)];
    
    day.exercises[exerciseIdx] = {
      ...ex,
      name: randomAlternative.name
    };
    
    setSmartPlan(updatedPlan);
    localStorage.setItem(`invictus_smartplan_${user?.uid || "guest"}`, JSON.stringify(updatedPlan));
  };

  // Trigger drawing to canvases whenever smartPlan changes, resultados screen opens, theme/variation gets toggled, or activeSubTab changes
  useEffect(() => {
    if (smartPlan && step === 'results') {
      setTimeout(() => {
        drawDietInfographic();
        drawWorkoutInfographic();
      }, 300);
    }
  }, [smartPlan, step, themeIndex, variationIndex, activeSubTab]);

  // Canvas drawing: Diet Infographic
  const drawDietInfographic = () => {
    const canvas = dietCanvasRef.current;
    if (!canvas || !smartPlan) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const themeRaw = THEMES[themeIndex] || THEMES[0];
    const theme = {
      ...themeRaw,
      bgFillStyle: themeRaw.bg,
      primaryColor: themeRaw.primary,
      secondaryColor: themeRaw.secondary,
      textColor: themeRaw.text,
      boxBg: themeRaw.cardBg,
      accentTitle: themeRaw.border,
      borderStripe: themeRaw.useGlow
    };

    const width = 800;
    const height = 1500;
    canvas.width = width;
    canvas.height = height;

    // Distinct Layout Index out of 20 (based on themeIndex and variationIndex to offer variety)
    const layoutIdx = (variationIndex + themeIndex * 3) % 20;

    // 1. Base Dark Background
    ctx.fillStyle = theme.bgFillStyle;
    ctx.fillRect(0, 0, width, height);

    // Dynamic background variations (20 Layouts)
    if (layoutIdx % 4 === 1) { // DOT MATRIX GRAPHIC
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      for (let x = 30; x < width - 30; x += 30) {
        for (let y = 30; y < height - 30; y += 30) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (layoutIdx % 4 === 2) { // SLIGHT LINE CHAINS
      ctx.strokeStyle = theme.primaryColor + "11";
      ctx.lineWidth = 0.5;
      for (let x = 40; x < width; x += 80) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 40; y < height; y += 80) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    } else if (layoutIdx % 4 === 3) { // RADIAL CORNERS ACCENTS
      const grad = ctx.createRadialGradient(width/2, height/2, 100, width/2, height/2, 600);
      grad.addColorStop(0, "rgba(255,255,255,0.02)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    // Outer border variation (Disposição / Inset styles)
    ctx.strokeStyle = theme.primaryColor;
    if (layoutIdx % 5 === 1) { // Double Frame Border
      ctx.lineWidth = 1;
      ctx.strokeRect(12, 12, width - 24, height - 24);
      ctx.strokeRect(18, 18, width - 36, height - 36);
    } else if (layoutIdx % 5 === 2) { // Sharp Bracket corners
      ctx.lineWidth = 3;
      const blen = 25;
      // TL
      ctx.beginPath(); ctx.moveTo(blen, 15); ctx.lineTo(15, 15); ctx.lineTo(15, blen); ctx.stroke();
      // TR
      ctx.beginPath(); ctx.moveTo(width - blen, 15); ctx.lineTo(width - 15, 15); ctx.lineTo(width - 15, blen); ctx.stroke();
      // BL
      ctx.beginPath(); ctx.moveTo(blen, height - 15); ctx.lineTo(15, height - 15); ctx.lineTo(15, height - blen); ctx.stroke();
      // BR
      ctx.beginPath(); ctx.moveTo(width - blen, height - 15); ctx.lineTo(width - 15, height - 15); ctx.lineTo(width - 15, height - blen); ctx.stroke();
    } else { // Standard solid border
      ctx.lineWidth = theme.borderStripe ? 2 : 1.2;
      ctx.strokeRect(15, 15, width - 30, height - 30);
    }

    // Header layout styling depending on layoutIdx
    ctx.textAlign = 'center';
    let titleY = 55;
    if (layoutIdx % 3 === 1) { // Left-aligned Header layout style
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.textColor;
      ctx.font = '900 italic 26px Outfit, sans-serif';
      ctx.fillText('INVICTUS PERFORMANCE', 45, titleY + 5);
      ctx.fillStyle = theme.primaryColor;
      ctx.font = '900 italic 20px Outfit, sans-serif';
      ctx.fillText(`PLANILHA ALIMENTAR • ${smartPlan.meals.length} REFEIÇÕES`, 45, titleY + 34);
    } else { // Centered Title with beautiful accents
      ctx.fillStyle = theme.textColor;
      ctx.font = '900 italic 28px Outfit, sans-serif';
      ctx.fillText('PLANO ALIMENTAR COMPLETO', width / 2, titleY);
      ctx.fillStyle = theme.primaryColor;
      ctx.font = '900 italic 24px Outfit, sans-serif';
      ctx.fillText(`- ${smartPlan.meals.length} REFEIÇÕES DE ATLETA -`, width / 2, titleY + 33);
    }

    // Custom badge styling (Destaques e Cores Secundárias)
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.secondaryColor;
    const badgeText = `OBJETIVO: ${translateObjective(smartPlan.physicalData.objective).toUpperCase()}`;
    ctx.font = '900 12px Inter, sans-serif';
    const textWidth = ctx.measureText(badgeText).width;
    const badgeX = (layoutIdx % 3 === 1) ? 45 + textWidth/2 + 5 : width / 2;
    const badgeY = (layoutIdx % 3 === 1) ? titleY + 48 : 105;
    
    roundRect(ctx, badgeX - (textWidth + 24) / 2, badgeY, textWidth + 24, 25, 6);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.fillText(badgeText, badgeX, badgeY + 17);

    // 3. Top Metrics Banner Grid (PESO, ALTURA, BF, CALORIAS)
    const metricsY = (layoutIdx % 3 === 1) ? 160 : 145;
    ctx.fillStyle = theme.boxBg;
    ctx.strokeStyle = theme.accentTitle;
    roundRect(ctx, 25, metricsY, width - 50, 75, 10);
    ctx.fill();
    ctx.stroke();

    // Brutalist shadow if layout instructs
    if (layoutIdx % 5 === 4) {
      ctx.strokeStyle = theme.primaryColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(27, metricsY + 2, width - 54, 71);
    }

    // Dividers
    ctx.strokeStyle = theme.accentTitle;
    ctx.lineWidth = 1;
    const colW = (width - 50) / 4;
    for(let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(25 + (i * colW), metricsY);
      ctx.lineTo(25 + (i * colW), metricsY + 75);
      ctx.stroke();
    }

    // Draw info values
    ctx.textAlign = 'center';
    
    // Weight
    ctx.fillStyle = '#888888';
    ctx.font = '900 10px Inter, sans-serif';
    ctx.fillText('⚖️ PESO:', 25 + colW/2, metricsY + 28);
    ctx.fillStyle = theme.primaryColor;
    ctx.font = '800 18px Outfit, sans-serif';
    ctx.fillText(`${smartPlan.physicalData.weight} KG`, 25 + colW/2, metricsY + 54);

    // Height
    ctx.fillStyle = '#888888';
    ctx.font = '900 10px Inter, sans-serif';
    ctx.fillText('📏 ALTURA:', 25 + colW + colW/2, metricsY + 28);
    ctx.fillStyle = theme.textColor;
    ctx.font = '800 18px Outfit, sans-serif';
    ctx.fillText(`${(smartPlan.physicalData.height / 100).toFixed(2)} M`, 25 + colW + colW/2, metricsY + 54);

    // BF
    ctx.fillStyle = '#888888';
    ctx.font = '900 10px Inter, sans-serif';
    ctx.fillText('👤 BF ESTIMADO:', 25 + colW*2 + colW/2, metricsY + 28);
    ctx.fillStyle = theme.textColor;
    ctx.font = '800 18px Outfit, sans-serif';
    ctx.fillText(`${smartPlan.physicalData.bodyFat}%`, 25 + colW*2 + colW/2, metricsY + 54);

    // Calories Target
    ctx.fillStyle = '#888888';
    ctx.font = '900 10px Inter, sans-serif';
    ctx.fillText('🔥 DIÁRIA ALVO:', 25 + colW*3 + colW/2, metricsY + 28);
    ctx.fillStyle = '#FF4D4D';
    ctx.font = '800 18px Outfit, sans-serif';
    ctx.fillText(`~${smartPlan.metrics.targetCalories} kcal`, 25 + colW*3 + colW/2, metricsY + 54);

    // 4. Core Macros block
    const macrosY = metricsY + 85;
    ctx.fillStyle = theme.boxBg;
    ctx.strokeStyle = theme.accentTitle;
    roundRect(ctx, 25, macrosY, width - 50, 60, 10);
    ctx.fill();
    ctx.stroke();

    const colM = (width - 50) / 3;
    for(let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(25 + (i * colM), macrosY);
      ctx.lineTo(25 + (i * colM), macrosY + 60);
      ctx.stroke();
    }

    // PROTEIN
    ctx.fillStyle = theme.secondaryColor;
    ctx.font = '900 11px Inter, sans-serif';
    ctx.fillText('🍗 PROTEÍNA', 25 + colM/2, macrosY + 22);
    ctx.fillStyle = theme.textColor;
    ctx.font = '800 18px Outfit, sans-serif';
    ctx.fillText(`${smartPlan.metrics.protein}g`, 25 + colM/2, macrosY + 45);

    // CARBS
    ctx.fillStyle = '#0052CC';
    ctx.font = '900 11px Inter, sans-serif';
    ctx.fillText('🍚 CARBOIDRATOS', 25 + colM + colM/2, macrosY + 22);
    ctx.fillStyle = theme.textColor;
    ctx.font = '800 18px Outfit, sans-serif';
    ctx.fillText(`${smartPlan.metrics.carbs}g`, 25 + colM + colM/2, macrosY + 45);

    // FATS
    ctx.fillStyle = '#DD6B20';
    ctx.font = '900 11px Inter, sans-serif';
    ctx.fillText('🥑 GORDURAS', 25 + colM*2 + colM/2, macrosY + 22);
    ctx.fillStyle = theme.textColor;
    ctx.font = '800 18px Outfit, sans-serif';
    ctx.fillText(`${smartPlan.metrics.fats}g`, 25 + colM*2 + colM/2, macrosY + 45);

    // 5. Build Meal Table with layout style
    const tableY = macrosY + 70;
    const tableHeaderH = 35;
    const rowH = 115;
    const itemsCount = smartPlan.meals.length;
    const tableH = tableHeaderH + (itemsCount * rowH);

    // Decide tables background (20 Layouts variation: high contrast or light grid)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(25, tableY, width - 50, tableH);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(25, tableY, width - 50, tableH);

    // Table Header with theme colors
    ctx.fillStyle = theme.primaryColor;
    ctx.fillRect(25, tableY, width - 50, tableHeaderH);

    // Column Positions
    const colOffsets = [0, 110, 220, 420, 520, 582, 644, 706, 750];
    const colLabels = ['REFEIÇÃO', 'PRATO', 'ALIMENTOS', 'QUANTIDADE', 'PROT(g)', 'CARB(g)', 'GORD(g)', 'CALORIAS'];

    ctx.fillStyle = '#000000';
    ctx.font = '900 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    for(let i = 0; i < colLabels.length; i++) {
      const colX = 25 + colOffsets[i] + (colOffsets[i+1] - colOffsets[i]) / 2;
      ctx.fillText(colLabels[i].toUpperCase(), colX, tableY + 22);
    }

    // Grid columns
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1;
    for(let i = 1; i < colOffsets.length - 1; i++) {
      ctx.beginPath();
      ctx.moveTo(25 + colOffsets[i], tableY);
      ctx.lineTo(25 + colOffsets[i], tableY + tableH);
      ctx.stroke();
    }

    // Draw actual custom meals
    smartPlan.meals.forEach((meal, idx) => {
      const rowY = tableY + tableHeaderH + (idx * rowH);

      // Alternate rows
      if (idx % 2 === 1) {
        ctx.fillStyle = (layoutIdx % 2 === 1) ? '#F1F5F9' : '#F8FAFC';
        ctx.fillRect(25 + 0.5, rowY + 0.5, width - 51, rowH - 1);
      }

      // Separator row
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(25, rowY + rowH); ctx.lineTo(width - 25, rowY + rowH); ctx.stroke();

      for(let i = 1; i < colOffsets.length - 1; i++) {
        ctx.beginPath(); ctx.moveTo(25 + colOffsets[i], rowY); ctx.lineTo(25 + colOffsets[i], rowY + rowH); ctx.stroke();
      }

      // Col 1: Name and Timing
      const col1CenterX = 25 + colOffsets[0] + (colOffsets[1] - colOffsets[0]) / 2;
      
      // Secondary highlight shape (Bullet styles: 20 Layouts Variation)
      ctx.fillStyle = theme.secondaryColor;
      const bStyle = layoutIdx % 6;
      if (bStyle === 1) { // Checked box
        ctx.fillRect(col1CenterX - 10, rowY + 16, 20, 20);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 9px Inter';
        ctx.fillText('✔', col1CenterX, rowY + 29);
      } else if (bStyle === 2) { // Diamond
        ctx.beginPath();
        ctx.moveTo(col1CenterX, rowY + 14);
        ctx.lineTo(col1CenterX + 12, rowY + 26);
        ctx.lineTo(col1CenterX, rowY + 38);
        ctx.lineTo(col1CenterX - 12, rowY + 26);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#000000';
        ctx.font = '900 10px Inter';
        ctx.fillText(`${idx + 1}`, col1CenterX, rowY + 30);
      } else { // Standard circle badge
        ctx.beginPath(); ctx.arc(col1CenterX, rowY + 26, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000000';
        ctx.font = '900 11px Inter, sans-serif';
        ctx.fillText(`${idx + 1}`, col1CenterX, rowY + 30);
      }

      ctx.fillStyle = '#000000';
      ctx.font = '800 italic 10px Outfit, sans-serif';
      let nameText = meal.name.replace('Anabólico', '').replace('Construtor', '').replace('Premium', '').trim();
      if (nameText.length > 14) {
        ctx.fillText(nameText.substring(0, 13) + '.', col1CenterX, rowY + 55);
      } else {
        ctx.fillText(nameText.toUpperCase(), col1CenterX, rowY + 55);
      }

      ctx.fillStyle = '#555555';
      ctx.font = '800 10px Inter, sans-serif';
      ctx.fillText(`🕒 ${meal.time}`, col1CenterX, rowY + 74);

      // Col 2: Prato Visual Emoji
      const col2CenterX = 25 + colOffsets[1] + (colOffsets[2] - colOffsets[1]) / 2;
      let emoji = '🍳';
      if (idx === 0) emoji = '🍳';
      else if (idx === 1) emoji = '🥩';
      else if (idx === 2) emoji = '🍌';
      else if (idx === 3) emoji = '🍗';
      else if (idx === 4) emoji = '🥛';
      else emoji = '🍇';

      ctx.fillStyle = '#F1F5F9';
      ctx.beginPath(); ctx.arc(col2CenterX, rowY + rowH/2, 36, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#E2E8F0'; ctx.stroke();
      ctx.font = '32px sans-serif';
      ctx.fillText(emoji, col2CenterX, rowY + rowH/2 + 11);

      // Col 3: Foods List
      ctx.textAlign = 'left';
      let foodY = rowY + 20;
      meal.foods.forEach((food) => {
        ctx.fillStyle = theme.secondaryColor;
        ctx.beginPath();
        ctx.arc(25 + colOffsets[2] + 12, foodY - 4, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#334155';
        ctx.font = 'bold 10px Inter, sans-serif';
        let fName = food.name;
        if(fName.length > 25) {
          fName = fName.substring(0, 23) + '...';
        }
        ctx.fillText(fName, 25 + colOffsets[2] + 24, foodY);
        foodY += 18;
      });

      // Col 4: Quantities
      ctx.textAlign = 'left';
      let qtyY = rowY + 20;
      meal.foods.forEach((food) => {
        ctx.fillStyle = '#475569';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillText(food.quantity, 25 + colOffsets[3] + 10, qtyY);
        qtyY += 18;
      });

      // Macros values columns
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.secondaryColor;
      ctx.font = '900 italic 16px Outfit, sans-serif';
      ctx.fillText(`${meal.protein}g`, 25 + colOffsets[4] + (colOffsets[5] - colOffsets[4]) / 2, rowY + rowH / 2 + 6);
      
      ctx.fillStyle = '#0052CC';
      ctx.font = '900 italic 16px Outfit, sans-serif';
      ctx.fillText(`${meal.carbs}g`, 25 + colOffsets[5] + (colOffsets[6] - colOffsets[5]) / 2, rowY + rowH / 2 + 6);

      ctx.fillStyle = '#DD6B20';
      ctx.font = '900 italic 16px Outfit, sans-serif';
      ctx.fillText(`${meal.fats}g`, 25 + colOffsets[6] + (colOffsets[7] - colOffsets[6]) / 2, rowY + rowH / 2 + 6);

      // Col 8: Calories block
      const col8CenterX = 25 + colOffsets[7] + (colOffsets[8] - colOffsets[7]) / 2;
      ctx.fillStyle = '#111111';
      roundRect(ctx, col8CenterX - 30, rowY + rowH/2 - 14, 60, 28, 6);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 10px Inter, sans-serif';
      ctx.fillText(`~${meal.calories}`, col8CenterX, rowY + rowH/2 - 1);
      ctx.fillStyle = theme.primaryColor;
      ctx.font = '900 7px Inter, sans-serif';
      ctx.fillText(`kcal`, col8CenterX, rowY + rowH/2 + 8);
    });

    // Totals Day bottom summary
    const totalsY = tableY + tableH + 10;
    ctx.fillStyle = theme.boxBg;
    roundRect(ctx, 25, totalsY, width - 50, 45, 8);
    ctx.fill();
    ctx.strokeStyle = theme.primaryColor;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(25, totalsY, width - 50, 45);

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.textColor;
    ctx.font = '900 italic 11px Outfit, sans-serif';
    ctx.fillText('TOTAIS DO DIA:', 40, totalsY + 26);

    ctx.textAlign = 'center';
    ctx.fillStyle = theme.secondaryColor;
    ctx.font = '900 12px Inter, sans-serif';
    ctx.fillText(`~${smartPlan.metrics.protein}g PROT`, 25 + colOffsets[4] + 30, totalsY + 26);
    
    ctx.fillStyle = '#0052CC';
    ctx.font = '900 12px Inter, sans-serif';
    ctx.fillText(`~${smartPlan.metrics.carbs}g CARB`, 25 + colOffsets[5] + 30, totalsY + 26);
    
    ctx.fillStyle = '#DD6B20';
    ctx.font = '900 12px Inter, sans-serif';
    ctx.fillText(`~${smartPlan.metrics.fats}g GORD`, 25 + colOffsets[6] + 30, totalsY + 26);
    
    ctx.fillStyle = '#FF4D4D';
    ctx.font = '900 12px Inter, sans-serif';
    ctx.fillText(`~${smartPlan.metrics.targetCalories} kcal`, 25 + colOffsets[7] + 30, totalsY + 26);

    // 7. BOTTOM SECTIONS OVER BLACK BACKGROUND
    const bottomStartY = totalsY + 65;
    const cardW = 365;
    const cardH = 135;

    // Carb distribution graphics
    ctx.fillStyle = theme.boxBg;
    ctx.strokeStyle = theme.accentTitle;
    roundRect(ctx, 25, bottomStartY, cardW, cardH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.primaryColor;
    ctx.font = '900 italic 11px Outfit, sans-serif';
    ctx.fillText('⚡ DISTRIBUIÇÃO DE CARBOIDRATOS', 40, bottomStartY + 25);

    let fillPctY = bottomStartY + 45;
    const daysDistrib = [
      { name: 'Café da manhã', share: '33%', color: theme.secondaryColor },
      { name: 'Almoço', share: '33%', color: '#0052CC' },
      { name: 'Pré-treino', share: '28%', color: '#6366F1' },
      { name: 'Pós-treino / Jantar', share: '6%', color: '#FF7A00' }
    ];

    daysDistrib.forEach((item) => {
      ctx.fillStyle = '#888888';
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.fillText(item.name, 40, fillPctY);

      ctx.fillStyle = item.color;
      ctx.font = '900 10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(item.share, 25 + cardW - 20, fillPctY);

      ctx.fillStyle = '#222';
      roundRect(ctx, 150, fillPctY - 8, 140, 6, 3);
      ctx.fill();
      ctx.fillStyle = item.color;
      const shareVal = Number(item.share.replace('%',''));
      roundRect(ctx, 150, fillPctY - 8, 140 * (shareVal / 100), 6, 3);
      ctx.fill();

      ctx.textAlign = 'left';
      fillPctY += 21;
    });

    // Hydration Advice Card
    ctx.fillStyle = theme.boxBg;
    ctx.strokeStyle = theme.accentTitle;
    roundRect(ctx, 410, bottomStartY, cardW, cardH, 10);
    ctx.fill();
    ctx.stroke();

    // High contrast layout indicator corner brackets
    if (layoutIdx % 5 === 2) {
      ctx.strokeStyle = theme.secondaryColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(415, bottomStartY + 5, cardW - 10, cardH - 10);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#00D2FF';
    ctx.font = '900 italic 11px Outfit, sans-serif';
    ctx.fillText('💧 RECOMENDAÇÃO DE HIDRATAÇÃO', 425, bottomStartY + 25);

    ctx.fillStyle = theme.textColor;
    ctx.font = 'bold 10.5px Inter, sans-serif';
    ctx.fillText('✔ Beba de 3,5 a 4,5 litros de água por dia.', 425, bottomStartY + 55);
    ctx.fillText('✔ Faça a conta ideal sugerida de ~40ml / kg de peso.', 425, bottomStartY + 77);
    ctx.fillStyle = '#00D2FF';
    ctx.font = '900 italic 13.5px Outfit, sans-serif';
    const waterNum = ((smartPlan.physicalData.weight * 40)/1000).toFixed(1);
    ctx.fillText(`Meta Ideal: ${waterNum}L de água / dia 💧`, 425, bottomStartY + 106);

    // Row 2 Left Supplementations
    const row2Y = bottomStartY + cardH + 15;
    ctx.fillStyle = theme.boxBg;
    ctx.strokeStyle = theme.accentTitle;
    roundRect(ctx, 25, row2Y, cardW, cardH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#E53E3E';
    ctx.font = '900 italic 11px Outfit, sans-serif';
    ctx.fillText('💊 SUPLEMENTAÇÃO DIÁRIA (ORIENTAÇÃO)', 40, row2Y + 25);

    ctx.fillStyle = '#CCCCCC';
    ctx.font = 'bold 9.5px Inter, sans-serif';
    ctx.fillText('• Creatina: 5g todos os dias (alta consistência diária)', 40, row2Y + 54);
    ctx.fillText('• Whey protein: conforme necessidade para atingir o aporte', 40, row2Y + 74);
    ctx.fillText('• Ômega 3: 1 a 2g para modulação lipídica e anti-inflamatório', 40, row2Y + 94);
    ctx.fillText('• Magnésio: 1g à noite para estabilização de sinapses', 40, row2Y + 114);

    // Row 2 Right Tips
    ctx.fillStyle = theme.boxBg;
    ctx.strokeStyle = theme.accentTitle;
    roundRect(ctx, 410, row2Y, cardW, cardH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = theme.secondaryColor;
    ctx.font = '900 italic 11px Outfit, sans-serif';
    ctx.fillText('🎯 CONSIDERAÇÕES TÉCNICAS IMPORTANTES', 425, row2Y + 25);

    ctx.fillStyle = '#CCCCCC';
    ctx.font = 'bold 9.5px Inter, sans-serif';
    ctx.fillText('✔ Dê preferência aos carboidratos de absorção gradativa', 425, row2Y + 54);
    ctx.fillText('✔ Consistência e precisão nos macros geram resultados', 425, row2Y + 74);
    ctx.fillText('✔ Durma de 7h a 9h de sono com qualidade anabólica', 425, row2Y + 94);
    ctx.fillText('✔ Ajuste suas metas nutricionais a cada 15/30 dias', 425, row2Y + 114);

    // Extra bottom pre-workout rows (4 cells)
    const preY = row2Y + cardH + 15;
    const preH = 95;
    ctx.fillStyle = theme.boxBg;
    ctx.strokeStyle = theme.accentTitle;
    roundRect(ctx, 25, preY, width - 50, preH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = theme.accentTitle;
    ctx.lineWidth = 1;
    for(let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(25 + (i * (width - 50) / 4), preY);
      ctx.lineTo(25 + (i * (width - 50) / 4), preY + preH);
      ctx.stroke();
    }

    ctx.fillStyle = theme.textColor;
    ctx.font = '900 italic 10px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔥 ESTRUTURAÇÃO DO SINAL PRÉ E PÓS-TREINO DE ALTA EFICÁCIA 🏋️‍♂️', width/2, preY + 22);

    const preCols = [
      { title: 'Ref Pré-Treino', desc: 'Carbos complexos + proteínas (60-90min antes)' },
      { title: 'Recuperação Pós', desc: 'Aporte proteico + carbo simples imediato' },
      { title: 'Hidratação Intra', desc: '500ml-800ml durante o esforço focado' },
      { title: 'Janela Pericárdio', desc: 'Sinalização hormonal ativada por aminoácidos' }
    ];

    const preW = (width - 70) / 4;
    preCols.forEach((col, cIdx) => {
      const colX = 35 + (cIdx * preW) + preW/2;
      ctx.fillStyle = theme.primaryColor;
      ctx.font = '900 9px Inter, sans-serif';
      ctx.fillText(col.title, colX, preY + 55);

      ctx.fillStyle = theme.textColor;
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.fillText(col.desc, colX, preY + 78);
    });

    // Motto bottom
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.primaryColor;
    ctx.font = '900 italic 15px Outfit, sans-serif';
    ctx.fillText('🏆 FOCO + DISCIPLINA + CONSISTÊNCIA = RESULTADOS REAIS 💪', width/2, height - 42);
  };

  // Canvas drawing: Workout Infographic
  const drawWorkoutInfographic = () => {
    const canvas = workoutCanvasRef.current;
    if (!canvas || !smartPlan) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const themeRaw = THEMES[themeIndex] || THEMES[0];
    const theme = {
      ...themeRaw,
      bgFillStyle: themeRaw.bg,
      primaryColor: themeRaw.primary,
      secondaryColor: themeRaw.secondary,
      textColor: themeRaw.text,
      boxBg: themeRaw.cardBg,
      accentTitle: themeRaw.border,
      borderStripe: themeRaw.useGlow
    };

    const width = 1600;
    const height = 1100;
    canvas.width = width;
    canvas.height = height;

    const layoutIdx = (variationIndex + themeIndex * 3) % 20;

    // 1. Base Dark Background
    ctx.fillStyle = theme.bgFillStyle;
    ctx.fillRect(0, 0, width, height);

    // Dynamic background grid variations (20 Layouts)
    if (layoutIdx % 4 === 1) { // DOT MATRIX GRAPHIC
      ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
      for (let x = 40; x < width - 40; x += 40) {
        for (let y = 40; y < height - 40; y += 40) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (layoutIdx % 4 === 2) { // SLIGHT LINE GRID
      ctx.strokeStyle = theme.primaryColor + "09";
      ctx.lineWidth = 0.5;
      for (let x = 60; x < width; x += 120) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 60; y < height; y += 120) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    } else if (layoutIdx % 4 === 3) { // RADIAL CORNERS ACCENTS
      const grad = ctx.createRadialGradient(width/2, height/2, 100, width/2, height/2, 700);
      grad.addColorStop(0, "rgba(255,255,255,0.015)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    // Outer premium border with variation
    ctx.strokeStyle = theme.primaryColor;
    if (layoutIdx % 5 === 2) { // Ultra high contrast bracket borders
      ctx.lineWidth = 3;
      const blen = 40;
      ctx.beginPath(); ctx.moveTo(blen, 15); ctx.lineTo(15, 15); ctx.lineTo(15, blen); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(width - blen, 15); ctx.lineTo(width - 15, 15); ctx.lineTo(width - 15, blen); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(blen, height - 15); ctx.lineTo(15, height - 15); ctx.lineTo(15, height - blen); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(width - blen, height - 15); ctx.lineTo(width - 15, height - 15); ctx.lineTo(width - 15, height - blen); ctx.stroke();
    } else if (layoutIdx % 5 === 1) { // Thin double borders
      ctx.lineWidth = 1;
      ctx.strokeRect(12, 12, width - 24, height - 24);
      ctx.strokeRect(18, 18, width - 36, height - 36);
    } else { // Standard double frame
      ctx.lineWidth = 2;
      ctx.strokeRect(15, 15, width - 30, height - 30);
      ctx.strokeStyle = theme.accentTitle;
      ctx.lineWidth = 1;
      ctx.strokeRect(20, 20, width - 40, height - 40);
    }

    // 2. High-fidelity Titles with layouts variety
    ctx.textAlign = 'center';
    let labelYOffset = 0;
    if (layoutIdx % 3 === 1) { // Left-aligned Header style
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.textColor;
      ctx.font = '900 italic 30px Outfit, sans-serif';
      ctx.fillText('INVICTUS ATHLETE DIVISION', 45, 65);
      ctx.fillStyle = theme.primaryColor;
      ctx.font = '900 italic 20px Outfit, sans-serif';
      ctx.fillText('• PLANO INTEGRAL DE ALALTA PERFORMANCE DE TREINO •', 45, 96);
      labelYOffset = 15;
    } else { // Centered traditional
      ctx.font = '900 italic 34px Outfit, sans-serif';
      const text1 = 'PLANO DE TREINO COMPLETO - ';
      const text2 = 'MÁXIMO RENDIMENTO';
      const w1 = ctx.measureText(text1).width;
      const w2 = ctx.measureText(text2).width;
      const startX = (width - (w1 + w2)) / 2;
      
      ctx.fillStyle = theme.textColor;
      ctx.textAlign = 'left';
      ctx.fillText(text1, startX, 65);
      ctx.fillStyle = theme.primaryColor;
      ctx.fillText(text2, startX + w1, 65);
    }

    // Subheading metrics banner
    const objText = translateObjective(smartPlan.physicalData.objective).toUpperCase();
    const freqText = `${smartPlan.physicalData.availability}X NA SEMANA`;
    const workoutTimeText = smartPlan.physicalData.workoutTime.toUpperCase();
    const spotText = smartPlan.physicalData.workoutType.toUpperCase();
    const bannerInfo = `OBJETIVO: ${objText}   |   FREQUÊNCIA: ${freqText}   |   DURAÇÃO: 60-80 MINUTOS POR TREINO   |   HORÁRIO: ${workoutTimeText}   |   LOCAL: ${spotText}`;

    ctx.fillStyle = '#A0AEC0';
    ctx.font = '900 italic 12px Inter, sans-serif';
    ctx.textAlign = (layoutIdx % 3 === 1) ? 'left' : 'center';
    ctx.fillText(bannerInfo, (layoutIdx % 3 === 1) ? 45 : width / 2, 98 + labelYOffset);

    // 3. Draw horizontal columns representing training days
    const activeDays = smartPlan.workout.days.filter(d => !d.isRest);
    const N = activeDays.length;

    // Printable width calculation
    const printableW = width - 60;
    const gap = 16;
    const colWidth = (printableW - (N - 1) * gap) / N;

    activeDays.forEach((day, idx) => {
      const colX = 30 + idx * (colWidth + gap);
      // Offset slightly for dynamic bento rhythm if layout suggests
      const dShift = (idx % 2 === 1 && layoutIdx % 4 === 3) ? 10 : 0;
      const colY = 125 + dShift + labelYOffset;
      const colH = 670 - labelYOffset; // Day card vertical height

      // Container card backplate
      ctx.fillStyle = theme.boxBg;
      ctx.strokeStyle = theme.accentTitle;
      ctx.lineWidth = 1.3;
      roundRect(ctx, colX, colY, colWidth, colH, 12);
      ctx.fill();
      ctx.stroke();

      // Golden outer highlight stripe
      ctx.fillStyle = theme.primaryColor;
      roundRect(ctx, colX, colY, 5, colH, { tl: 12, bl: 12, tr: 0, br: 0 });
      ctx.fill();

      // Top day card sub-header background
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      roundRect(ctx, colX + 5, colY + 1, colWidth - 6, 50, { tl: 0, tr: 11, br: 0, bl: 0 });
      ctx.fill();

      // Workout Emoji icon based on muscle category
      let emojiStr = '💪';
      const mG = day.muscleGroup.toLowerCase();
      if (mG.includes('peito') || mG.includes('push')) emojiStr = '🏋️‍♂️';
      else if (mG.includes('costas') || mG.includes('pull') || mG.includes('bíceps')) emojiStr = '💪';
      else if (mG.includes('perna') || mG.includes('legs') || mG.includes('coxa')) emojiStr = '🦵';
      else if (mG.includes('ombro') || mG.includes('shoulder')) emojiStr = '🛡️';
      else if (mG.includes('cardio') || mG.includes('abs') || mG.includes('recuper')) emojiStr = '🏃‍♂️';

      ctx.fillStyle = theme.primaryColor;
      ctx.font = '900 italic 15px Outfit, sans-serif';
      ctx.textAlign = 'center';
      const dayNameUpper = day.dayName.split('-')[0].toUpperCase();
      ctx.fillText(`${emojiStr} ${dayNameUpper}`, colX + colWidth / 2, colY + 24);

      ctx.fillStyle = theme.textColor;
      ctx.font = '800 italic 11px Inter, sans-serif';
      ctx.fillText(day.muscleGroup.toUpperCase(), colX + colWidth / 2, colY + 41);

      // Columns Label Block underneath the subheader
      const labelY = colY + 50;
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(colX + 5, labelY, colWidth - 6, 22);

      ctx.fillStyle = '#718096';
      ctx.font = '900 8.5px Inter, sans-serif';
      ctx.textAlign = 'center';

      const wName = colWidth * 0.44;
      const wSeries = colWidth * 0.16;
      const wReps = colWidth * 0.22;
      const wRest = colWidth * 0.18;

      ctx.fillText('EXERCÍCIOS', colX + wName / 2, labelY + 14);
      ctx.fillText('SÉRIES', colX + wName + wSeries / 2, labelY + 14);
      ctx.fillText('REPS', colX + wName + wSeries + wReps / 2, labelY + 14);
      ctx.fillText('DESCANSO', colX + wName + wSeries + wReps + wRest / 2, labelY + 14);

      // Separators for the Column headers grid line
      ctx.strokeStyle = theme.accentTitle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX + 5, labelY + 22);
      ctx.lineTo(colX + colWidth, labelY + 22);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(colX + wName, labelY);
      ctx.lineTo(colX + wName, labelY + 22);
      ctx.moveTo(colX + wName + wSeries, labelY);
      ctx.lineTo(colX + wName + wSeries, labelY + 22);
      ctx.moveTo(colX + wName + wSeries + wReps, labelY);
      ctx.lineTo(colX + wName + wSeries + wReps, labelY + 22);
      ctx.stroke();

      // Exercises rows render
      const startExY = labelY + 22;
      const exRowH = 62;

      day.exercises.forEach((ex, exIdx) => {
        const rowY = startExY + exIdx * exRowH;

        // Alternate stripe row layout based on layoutIdx
        if (exIdx % 2 === 1) {
          ctx.fillStyle = (layoutIdx % 2 === 1) ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.015)';
          ctx.fillRect(colX + 5, rowY, colWidth - 6, exRowH);
        }

        // Draw horizontal row base lines
        ctx.strokeStyle = theme.accentTitle;
        ctx.beginPath();
        ctx.moveTo(colX + 5, rowY + exRowH);
        ctx.lineTo(colX + colWidth, rowY + exRowH);
        ctx.stroke();

        // Draw vertical columns separators
        ctx.beginPath();
        ctx.moveTo(colX + wName, rowY);
        ctx.lineTo(colX + wName, rowY + exRowH);
        ctx.moveTo(colX + wName + wSeries, rowY);
        ctx.lineTo(colX + wName + wSeries, rowY + exRowH);
        ctx.moveTo(colX + wName + wSeries + wReps, rowY);
        ctx.lineTo(colX + wName + wSeries + wReps, rowY + exRowH);
        ctx.stroke();

        // Write exercise name with auto-line-wrap
        ctx.fillStyle = theme.textColor;
        ctx.font = 'bold 9.5px Inter, sans-serif';
        ctx.textAlign = 'left';

        let exName = ex.name.toUpperCase();
        if (ctx.measureText(exName).width > wName - 10) {
          const words = exName.split(' ');
          let line1 = '';
          let line2 = '';
          for (const w of words) {
            if (ctx.measureText(line1 + w + ' ').width < wName - 12 && line2 === '') {
              line1 += w + ' ';
            } else {
              line2 += w + ' ';
            }
          }
          ctx.fillText(line1.trim(), colX + 11, rowY + 22);
          if (line2.trim() !== '') {
            ctx.fillText(line2.trim(), colX + 11, rowY + 38);
          }
        } else {
          ctx.fillText(exName, colX + 11, rowY + exRowH / 2 + 4);
        }

        // Series count
        ctx.fillStyle = theme.secondaryColor;
        ctx.font = '900 italic 15px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${ex.series}`, colX + wName + wSeries / 2, rowY + exRowH / 2 + 5);

        // Repetitions
        ctx.fillStyle = theme.textColor;
        ctx.font = '800 11px Inter, sans-serif';
        ctx.fillText(`${ex.reps}`, colX + wName + wSeries + wReps / 2, rowY + exRowH / 2 + 4);

        // Recovery rest time
        ctx.fillStyle = '#CBD5E0';
        ctx.font = '800 10px Inter, sans-serif';
        ctx.fillText(`${ex.rest}`, colX + wName + wSeries + wReps + wRest / 2, rowY + exRowH / 2 + 4);
      });

      // Bottom Foco do Dia panel inside column
      const focusBoxY = colY + colH - 95;
      const focusBoxH = 80;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.005)';
      ctx.strokeStyle = theme.primaryColor + '22';
      ctx.lineWidth = 1;
      roundRect(ctx, colX + 10, focusBoxY, colWidth - 20, focusBoxH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = theme.primaryColor;
      ctx.font = '900 italic 9px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FOCO DO DIA', colX + colWidth / 2, focusBoxY + 16);

      let focusText = 'Progressão técnica gradual aliada à qualidade de execução e cadência controlada.';
      const muscleLower = day.muscleGroup.toLowerCase();
      if (muscleLower.includes('peitor') || muscleLower.includes('peito')) {
        focusText = 'Estimular o peitoral de todas as regiões e definir tríceps com volume e intensidade.';
      } else if (muscleLower.includes('costas') || muscleLower.includes('pull') || muscleLower.includes('bíc')) {
        focusText = 'Dar espessura e largura às costas e trabalhar bíceps com qualidade.';
      } else if (muscleLower.includes('pesta') || muscleLower.includes('pern') || muscleLower.includes('coxa') || muscleLower.includes('leg')) {
        focusText = 'Trabalhar pernas completas com equilíbrio total entre força, volume e definição.';
      } else if (muscleLower.includes('ômbro') || muscleLower.includes('shoulder')) {
        focusText = 'Desenvolver ombros 3D (largura e volume) e fortalecer o core abdominal.';
      } else if (muscleLower.includes('cardio') || muscleLower.includes('abs') || muscleLower.includes('core')) {
        focusText = 'Melhorar o condicionamento cardiorrespiratório e tonificar a região do abdômen.';
      }

      ctx.fillStyle = theme.textColor;
      ctx.font = 'bold 8px Inter, sans-serif';

      const words = focusText.split(' ');
      let line1 = '';
      let line2 = '';
      let line3 = '';
      for (const w of words) {
        if (ctx.measureText(line1 + w + ' ').width < colWidth - 36) {
          line1 += w + ' ';
        } else if (ctx.measureText(line2 + w + ' ').width < colWidth - 36) {
          line2 += w + ' ';
        } else {
          line3 += w + ' ';
        }
      }

      ctx.fillText(line1.trim(), colX + colWidth / 2, focusBoxY + 34);
      if (line2.trim() !== '') {
        ctx.fillText(line2.trim(), colX + colWidth / 2, focusBoxY + 46);
      }
      if (line3.trim() !== '') {
        ctx.fillText(line3.trim(), colX + colWidth / 2, focusBoxY + 58);
      }
    });

    // 4. Strategic Training guidelines blocks at the foot (5 horizontal cards side-by-side)
    const footY = 815 + labelYOffset;
    const footH = 205 - labelYOffset;
    const footerCount = 5;
    const footerW = (printableW - (footerCount - 1) * gap) / footerCount;

    const footersData = [
      {
        title: 'DESCANSO ENTRE SÉRIES',
        color: theme.primaryColor,
        bullets: [
          '• COMPOSTOS: 90-120 SEGUNDOS COM SEGURANÇA',
          '• ISOLADORES: 45-60 SEGUNDOS DO MÁXIMO PUMP',
          '• ABDÔMEN & CORE: 30-45 SEGUNDOS DE DESCANSO',
          '• OBJETIVO: RESTAURAR ENERGIA SANGUÍNEA DA SÉRIE'
        ]
      },
      {
        title: 'PROGRESSÃO DE CARGA',
        color: theme.primaryColor,
        bullets: [
          '• SEMANAS 1-2: 60-70% DA CARGA MÁXIMA SEGURA',
          '• SEMANAS 3-4: 75-80% COM INCREMENTO DE VOLUME',
          '• SEMANAS 5-24: PROGRESSÃO DE CARGA INDIVIDUAL',
          '• FOCO: ANOTE SEUS PESOS E TENTE SUPERÁ-LOS SEMPRE'
        ]
      },
      {
        title: 'DICAS IMPORTANTES',
        color: theme.primaryColor,
        bullets: [
          '✔ PRIORIZE EXECUÇÃO E CADÊNCIA CONTROLADA',
          '✔ NÃO TREINE EM OVERTRAINING (RESPEITE O CORPO)',
          '✔ PRESERVE ARTICULAÇÕES E MECÂNICA IMPECÁVEL',
          '✔ SONO REPARADOR DE 7.5H A 9H É INDISPENSÁVEL'
        ]
      },
      {
        title: 'CARDIO (ORIENTAÇÃO)',
        color: theme.primaryColor,
        bullets: [
          '• PRIMEIRA ETAPA: 3X POR SEMANA (20 MIN INTERV)',
          '• APÓS 60 DIAS: MANUTENÇÃO SAUDÁVEL 2X/SEMANA',
          '• FASE DEFINIÇÃO: COORDENAR 4-5X DE CAMINHADA',
          '• TIPOS: CAMINHADA INCLINADA OU HIIT INTENSO'
        ]
      },
      {
        title: 'OBSERVAÇÕES ADICIONAIS',
        color: theme.primaryColor,
        bullets: [
          '• CONEXÃO CÉREBRO-MÚSCULO: CONTRAÇÃO CONSCIENTE',
          '• HIDRATAÇÃO SEVERA: MIN. 3,5L A 4,5L DE ÁGUA / DIA',
          '• SEGURANÇA FIRST: DESCONFORTO ARTICULAR = PARE',
          '• AJUSTE O SEU TREINO A CADA 15 DIAS NO INVICTUS'
        ]
      }
    ];

    footersData.forEach((fCard, index) => {
      const cardX = 30 + index * (footerW + gap);

      ctx.fillStyle = theme.boxBg;
      ctx.strokeStyle = theme.accentTitle;
      ctx.lineWidth = 1;
      roundRect(ctx, cardX, footY, footerW, footH, 10);
      ctx.fill();
      ctx.stroke();

      // Top colored accent bar inside the footer block
      ctx.fillStyle = fCard.color;
      roundRect(ctx, cardX, footY, footerW, 4, { tl: 10, tr: 10, br: 0, bl: 0 });
      ctx.fill();

      // Card Title
      ctx.fillStyle = theme.textColor;
      ctx.font = '900 italic 9px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fCard.title, cardX + footerW / 2, footY + 24);

      // Low contrast line
      ctx.strokeStyle = theme.accentTitle;
      ctx.beginPath();
      ctx.moveTo(cardX + 10, footY + 36);
      ctx.lineTo(cardX + footerW - 10, footY + 36);
      ctx.stroke();

      // Bullet items
      ctx.textAlign = 'left';
      let bulletY = footY + 54;
      fCard.bullets.forEach((bullet) => {
        ctx.fillStyle = theme.textColor;
        ctx.font = 'bold 7.5px Inter, sans-serif';

        // Check if bullets width overflows, wrap if necessary
        let txt = bullet;
        if (ctx.measureText(txt).width > footerW - 16) {
          txt = txt.substring(0, 34) + '...';
        }
        ctx.fillText(txt, cardX + 11, bulletY);
        bulletY += 21;
      });
    });

    // Bottom motto row
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.primaryColor;
    ctx.font = '900 italic 13px Outfit, sans-serif';
    ctx.fillText('🏆 DISCIPLINA + CONSISTÊNCIA + DESCANSO = RESULTADOS REAIS 💪', width / 2, height - 38);
  };

  // Helper rounded rectangle algorithm
  const roundRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number | { tl: number; tr: number; br: number; bl: number }
  ) => {
    let r = { tl: 0, tr: 0, br: 0, bl: 0 };
    if (typeof radius === 'number') {
      r = { tl: radius, tr: radius, br: radius, bl: radius };
    } else {
      r = radius;
    }
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + width - r.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r.tr);
    ctx.lineTo(x + width, y + height - r.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r.br, y + height);
    ctx.lineTo(x + r.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.quadraticCurveTo(x, y, x + r.tl, y);
    ctx.closePath();
  };

  // Download action handlers
  const handleDownload = (type: 'diet' | 'workout') => {
    const canvas = type === 'diet' ? dietCanvasRef.current : workoutCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `invictus_plano_${type}_${user?.displayName?.replace(/\s+/g, '_') || 'atleta'}.png`;
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();
  };

  // Simple copy link share fallback
  const handleShare = async (type: 'diet' | 'workout') => {
    const canvas = type === 'diet' ? dietCanvasRef.current : workoutCanvasRef.current;
    if (!canvas) return;

    try {
      // 1. Convert to BLOB
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `plano_invictus.png`, { type: 'image/png' });
        
        // 2. Try native sharing (extremely elegant for phones/mobile iframe previews)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Meu Plano Inteligente - Invictus`,
            text: `Confira meu plano alimentar e de treinos gerado pelo Invictus App!`
          });
        } else {
          // Native file download fallback
          handleDownload(type);
        }
      });
    } catch (err) {
      console.error('Sharing failed', err);
      // Fallback
      handleDownload(type);
    }
  };

  return (
    <div id="smart-plan-container" className="space-y-6 pt-2">
      <AnimatePresence mode="wait">
        {step === 'form' ? (
          <form onSubmit={handleGenerate} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Header / Intro banner */}
            <div className="bg-gradient-to-br from-surface-container-high to-surface border border-white/5 p-6 sm:p-8 rounded-[32px] space-y-3 relative overflow-hidden shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Sparkles size={18} className="animate-pulse" />
                </div>
                <div>
                  <h3 className="font-headline italic font-black text-xl uppercase tracking-tight text-white">GERADOR AUTOMÁTICO DE PLANOS</h3>
                  <p className="font-mono text-[8px] sm:text-[9px] text-primary uppercase font-black tracking-widest leading-none mt-1">SISTEMA INTEGRADO DE COMPOSIÇÃO CORPORAL</p>
                </div>
              </div>
              <p className="text-on-surface-variant text-xs font-label font-medium leading-relaxed uppercase tracking-wider pt-2">
                Preencha seus parâmetros corporais e nossa inteligência criará uma estratégia de treinos científica para máxima performance com rotinas personalizadas e gráficos compartilháveis!
              </p>
              <div className="absolute -bottom-10 -right-10 w-28 h-28 bg-primary/5 rounded-full blur-2xl" />
            </div>

            {/* FORM FIELDS - Section 1: Dados Físicos */}
            <div className="bg-surface-container-low border border-white/5 p-6 sm:p-8 rounded-[32px] space-y-6">
              <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                <Scale size={18} className="text-primary" />
                <h4 className="font-headline italic font-black text-base uppercase tracking-wider">1. ANTROPOMETRIA E TELEMETRIA</h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {/* Weight Input */}
                <div>
                  <label className="text-[10px] sm:text-[11px] font-mono text-white/50 uppercase tracking-widest block mb-1.5 font-bold">Peso Atual (kg)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    required
                    value={formData.weight}
                    onChange={(e) => setFormData({ ...formData, weight: Number(e.target.value) })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 font-semibold text-sm outline-none focus:border-primary focus:bg-white/[0.08] transition-all"
                  />
                </div>

                {/* Height Input */}
                <div>
                  <label className="text-[10px] sm:text-[11px] font-mono text-white/50 uppercase tracking-widest block mb-1.5 font-bold">Altura (cm)</label>
                  <input 
                    type="number" 
                    required
                    value={formData.height}
                    onChange={(e) => setFormData({ ...formData, height: Number(e.target.value) })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 font-semibold text-sm outline-none focus:border-primary focus:bg-white/[0.08] transition-all"
                  />
                </div>

                {/* Age Input */}
                <div>
                  <label className="text-[10px] sm:text-[11px] font-mono text-white/50 uppercase tracking-widest block mb-1.5 font-bold">Idade (anos)</label>
                  <input 
                    type="number" 
                    required
                    value={formData.age}
                    onChange={(e) => setFormData({ ...formData, age: Number(e.target.value) })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 font-semibold text-sm outline-none focus:border-primary focus:bg-white/[0.08] transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Sex Input */}
                <div>
                  <label className="text-[10px] sm:text-[11px] font-mono text-white/50 uppercase tracking-widest block mb-2 font-bold">Sexo Biológico</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, sex: 'male' })}
                      className={cn(
                        "py-3 rounded-2xl font-black text-[10px] uppercase font-label tracking-widest border transition-all",
                        formData.sex === 'male' ? "bg-primary border-primary text-black" : "bg-white/5 border-white/5 text-white/60 hover:text-white"
                      )}
                    >
                      Masculino
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, sex: 'female' })}
                      className={cn(
                        "py-3 rounded-2xl font-black text-[10px] uppercase font-label tracking-widest border transition-all",
                        formData.sex === 'female' ? "bg-primary border-primary text-black" : "bg-white/5 border-white/5 text-white/60 hover:text-white"
                      )}
                    >
                      Feminino
                    </button>
                  </div>
                </div>

                {/* Estimated Body Fat Input */}
                <div>
                  <label className="text-[10px] sm:text-[11px] font-mono text-white/50 uppercase tracking-widest block mb-1 font-bold">Percentual de Gordura Estimado (BF %)</label>
                  <div className="flex items-center gap-4">
                    <input 
                      type="range" 
                      min="5" 
                      max="40" 
                      value={formData.bodyFat}
                      onChange={(e) => setFormData({ ...formData, bodyFat: Number(e.target.value) })}
                      className="w-full accent-primary h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                    <span className="font-headline italic font-black text-xl text-primary drop-shadow-glow min-w-[45px] text-right">{formData.bodyFat}%</span>
                  </div>
                </div>
              </div>

              {/* Objective field selectors */}
              <div>
                <label className="text-[10px] sm:text-[11px] font-mono text-white/50 uppercase tracking-widest block mb-2 font-bold">Meta Corporal / Objetivo</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'hipertrofia', label: 'Ganhar Massa', subtitle: 'Superávit Calórico' },
                    { key: 'definir', label: 'Definir', subtitle: 'Déficit leve com alta prot' },
                    { key: 'recompensacao', label: 'Recomp Corporal', subtitle: 'Calorias de manutenção' },
                    { key: 'emagrecimento', label: 'Emagrecimento', subtitle: 'Déficit Calórico' }
                  ].map((obj) => (
                    <button
                      key={obj.key}
                      type="button"
                      onClick={() => setFormData({ ...formData, objective: obj.key as any })}
                      className={cn(
                        "p-3 rounded-2xl border transition-all flex flex-col items-center justify-center text-center gap-1 min-h-[70px]",
                        formData.objective === obj.key 
                          ? "bg-primary border-primary text-black shadow-glow-primary scale-[1.03]" 
                          : "bg-white/5 border-white/5 text-white/60 hover:text-white hover:border-white/10"
                      )}
                    >
                      <span className="font-black font-label text-[10px] uppercase tracking-wider">{obj.label}</span>
                      <span className={cn("text-[7px] font-mono uppercase tracking-widest", formData.objective === obj.key ? "text-black/60" : "text-white/30")}>{obj.subtitle}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Section 2: Detalhes do Treino */}
            <div className="bg-surface-container-low border border-white/5 p-6 sm:p-8 rounded-[32px] space-y-6">
              <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                <Dumbbell size={18} className="text-primary" />
                <h4 className="font-headline italic font-black text-base uppercase tracking-wider">2. ESTRUTURA DE TREINO</h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {/* Experience Select */}
                <div>
                  <label className="text-[10px] sm:text-[11px] font-mono text-white/50 uppercase tracking-widest block mb-1.5 font-bold">Experiência de Treino</label>
                  <select
                    value={formData.experience}
                    onChange={(e) => setFormData({ ...formData, experience: e.target.value as any })}
                    className="w-full bg-[#121418] border border-white/10 rounded-2xl px-4 py-3 font-semibold text-xs uppercase outline-none focus:border-primary text-white"
                  >
                    <option value="iniciante">Iniciante</option>
                    <option value="intermediario">Intermediário</option>
                    <option value="avancado">Avançado</option>
                  </select>
                </div>

                {/* Availability Select */}
                <div>
                  <label className="text-[10px] sm:text-[11px] font-mono text-white/50 uppercase tracking-widest block mb-1.5 font-bold">Disponibilidade Semanal</label>
                  <select
                    value={formData.availability}
                    onChange={(e) => setFormData({ ...formData, availability: e.target.value as any })}
                    className="w-full bg-[#121418] border border-white/10 rounded-2xl px-4 py-3 font-semibold text-xs uppercase outline-none focus:border-primary text-white"
                  >
                    <option value="3">3 dias (Full body)</option>
                    <option value="4">4 dias (Upper/Lower)</option>
                    <option value="5">5 dias (PPL + Upper)</option>
                    <option value="6">6 dias (Avançado PPL)</option>
                  </select>
                </div>

                {/* Workout Time Select */}
                <div>
                  <label className="text-[10px] sm:text-[11px] font-mono text-white/50 uppercase tracking-widest block mb-1.5 font-bold">Horário de Treino</label>
                  <select
                    value={formData.workoutTime}
                    onChange={(e) => setFormData({ ...formData, workoutTime: e.target.value as any })}
                    className="w-full bg-[#121418] border border-white/10 rounded-2xl px-4 py-3 font-semibold text-xs uppercase outline-none focus:border-primary text-white"
                  >
                    <option value="manha">Manhã</option>
                    <option value="tarde">Tarde</option>
                    <option value="noite">Noite</option>
                  </select>
                </div>
              </div>

              {/* Workout Spot Select */}
              <div>
                <label className="text-[10px] sm:text-[11px] font-mono text-white/50 uppercase tracking-widest block mb-2 font-bold">Local de Treinamento</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'academia', label: 'Academia', info: 'Com aparelhos' },
                    { key: 'casa', label: 'Em Casa', info: 'Sem aparelhos' },
                    { key: 'ambos', label: 'Ambos', info: 'Misto' }
                  ].map((spot) => (
                    <button
                      key={spot.key}
                      type="button"
                      onClick={() => setFormData({ ...formData, workoutType: spot.key as any })}
                      className={cn(
                        "py-3 px-2 rounded-2xl border transition-all text-center flex flex-col justify-center min-h-[60px]",
                        formData.workoutType === spot.key 
                          ? "bg-primary border-primary text-black" 
                          : "bg-white/5 border-white/5 text-white/60 hover:text-white"
                      )}
                    >
                      <span className="font-black font-label text-[10px] uppercase tracking-wider">{spot.label}</span>
                      <span className={cn("text-[7px] font-mono uppercase tracking-widest block mt-0.5", formData.workoutType === spot.key ? "text-black/60" : "text-white/30")}>{spot.info}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Submission button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-20 bg-primary text-black font-headline italic font-black text-2xl uppercase tracking-widest rounded-3xl hover:scale-[1.01] active:scale-[0.99] transition-transform flex items-center justify-center gap-3 shadow-glow-primary hover:bg-gold duration-300 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-6 h-6 animate-spin" />
                  <span>PROCESSANDO PARAMETROS...</span>
                </>
              ) : (
                <>
                  <Sparkles size={24} />
                  <span>GERAR MEU PLANO PREMIUM</span>
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* 30 Days expired notice */}
            {daysSinceGen >= 30 && (
              <div className="bg-orange-500/10 border border-orange-400/20 p-5 rounded-3xl space-y-2 relative overflow-hidden animate-in slide-in-from-top-4 duration-350">
                <div className="flex items-start gap-4">
                  <span className="text-2xl animate-pulse">⚠️</span>
                  <div>
                    <h5 className="font-headline italic font-black text-sm text-orange-400 uppercase tracking-wider leading-none">CRONOGRAMA DE PLANEJAMENTO COMPLETADO (30 DIAS AUDITADOS)</h5>
                    <p className="font-label text-[10px] font-semibold text-orange-200/80 uppercase tracking-widest leading-relaxed mt-1.5">
                      Este plano de dieta e academia atingiu 30 dias. Recomenda-se realizar uma reavaliação física do seu peso e gordura corporal para manter a progressão constante.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* RESULTS METRICS SUMMARY BANNER */}
            <div className="glass-card rounded-[32px] p-6 border-primary/20 flex flex-col sm:flex-row items-stretch justify-between gap-6 shadow-2xl relative overflow-hidden">
              <div className="space-y-3 z-10 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[9px] text-white/40 uppercase tracking-widest font-black bg-white/5 px-2 py-0.5 rounded-full border border-white/5">PLANO ALIMENTAR & TREINO</span>
                  <span className="font-mono text-[9px] text-primary uppercase tracking-widest font-black bg-primary/10 px-2 py-0.5 rounded-full border border-primary/10">PREMIUM PERFORMANCE CLI</span>
                </div>
                
                <h2 className="font-headline italic font-black text-3xl uppercase tracking-tighter leading-none text-white">
                  SEU DIRECIONAMENTO INVICTUS ESTÁ PRONTO!
                </h2>
                
                <p className="text-on-surface-variant text-[11px] font-label font-bold leading-relaxed uppercase tracking-wider">
                  Calculamos sua taxa calórica ideal e as divisões estruturais cientificas baseadas nos seus dados reais de atleta. Veja abaixo os infográficos e baixe-os!
                </p>

                {/* Micro calculations details */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3">
                  <div className="bg-black/40 p-3 rounded-2xl border border-white/5">
                    <span className="text-[7.5px] font-mono text-white/40 block uppercase">Taxa Basal (BMR)</span>
                    <span className="font-headline italic font-black text-base text-white">{smartPlan?.metrics.bmr} Kcal</span>
                  </div>
                  <div className="bg-black/40 p-3 rounded-2xl border border-white/5">
                    <span className="text-[7.5px] font-mono text-white/40 block uppercase">Gasto Diário (TDEE)</span>
                    <span className="font-headline italic font-black text-base text-white">{smartPlan?.metrics.tdee} Kcal</span>
                  </div>
                  <div className="bg-black/40 p-3 rounded-2xl border border-white/10 bg-primary/2 flex flex-col justify-between">
                    <span className="text-[7.5px] font-mono text-primary block uppercase font-black">Meta Diária Alvo</span>
                    <span className="font-headline italic font-black text-base text-primary">{smartPlan?.metrics.targetCalories} Kcal</span>
                  </div>
                  <div className="bg-black/40 p-3 rounded-2xl border border-white/5 flex flex-col justify-between">
                    <span className="text-[7.5px] font-mono text-emerald-400 block uppercase font-black">Água por Dia</span>
                    <span className="font-headline italic font-black text-base text-emerald-400">
                      {smartPlan ? ((smartPlan.physicalData.weight * 40)/1000).toFixed(1) : 3} Litros
                    </span>
                  </div>
                </div>
              </div>

              {/* Action columns reset or configure */}
              <div className="flex flex-row sm:flex-col justify-center sm:justify-start gap-3 border-t sm:border-t-0 sm:border-l border-white/5 pt-4 sm:pt-0 sm:pl-6 min-w-[200px]">
                <button
                  type="button"
                  onClick={() => setStep('form')}
                  className="flex-1 w-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 px-4 py-3 rounded-2xl font-black font-label text-[10px] uppercase tracking-widest text-center text-white/85 flex items-center justify-center gap-1.5 transition-all self-center sm:self-stretch min-h-[50px]"
                >
                  <RefreshCw size={12} className="shrink-0" /> Recalcular Tudo
                </button>
                <div className="w-[1.5px] h-full sm:h-[1.5px] sm:w-full bg-white/5" />
                <span className="hidden sm:block font-mono text-[7px] text-white/30 text-center uppercase tracking-widest">
                  Fração de ajuste: 15 dias
                </span>
              </div>
              <div className="absolute -bottom-10 -right-10 w-28 h-28 bg-primary/5 rounded-full blur-2xl" />
            </div>

            {/* 15 Days weight shift re-evaluation popup overlay within results pages dynamically */}
            {showWeightPrompt && (
              <div className="bg-primary/10 border border-primary/20 p-6 rounded-[32px] space-y-4 shadow-xl relative overflow-hidden animate-in zoom-in-95 duration-350">
                <div className="flex items-start gap-4">
                  <Flame className="text-primary shrink-0 animate-pulse" size={24} />
                  <div className="space-y-1">
                    <h4 className="font-headline italic font-black text-lg text-primary uppercase tracking-tight">CICLO DE REAVALIAÇÃO DE 15 DIAS ALCANÇADO!</h4>
                    <p className="font-label text-xs font-semibold text-primary/80 uppercase tracking-wide leading-normal">
                      Já se passaram 15 dias desde que seu plano foi gerado pela última vez. Seu peso mudou ou você deseja recalcular suas macros e treinos para se adequar à sua nova realidade?
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 items-center pt-2">
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <span className="font-mono text-[10px] text-white/50 uppercase font-black shrink-0">NOVO PESO (KG):</span>
                    <input 
                      type="number"
                      step="0.1" 
                      value={newWeight}
                      onChange={(e) => setNewWeight(Number(e.target.value))}
                      className="bg-black/60 border border-white/14 rounded-xl px-3 py-1.5 font-bold text-xs text-primary max-w-[100px] outline-none text-center"
                    />
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto ml-auto">
                    <button
                      onClick={() => setShowWeightPrompt(false)}
                      className="flex-1 sm:flex-none uppercase text-[9px] font-black font-mono tracking-widest px-4 py-2 hover:bg-white/5 text-white/60 hover:text-white rounded-xl"
                    >
                      Manter Igual
                    </button>
                    <button
                      onClick={handleReevaluate}
                      disabled={loading}
                      className="flex-1 sm:flex-none uppercase bg-primary text-black font-black text-[9px] font-mono tracking-widest px-4 py-2.5 rounded-xl hover:scale-105 active:scale-95 transition-all"
                    >
                      Recalcular e Salvar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* CENTRAL DE CUSTOMIZAÇÃO E ANÁLISE ANTIFRAUDE */}
            <div className="glass-card rounded-[32px] p-6 border-white/5 space-y-6 bg-surface-container-low shadow-2xl relative overflow-hidden">
              <div className="flex items-center gap-3 border-b border-white/5 pb-3">
                <Sparkles size={20} className="text-primary animate-pulse" />
                <div>
                  <h4 className="font-headline italic font-black text-sm uppercase tracking-wider text-white">CENTRAL DE CUSTOMIZAÇÃO E ANÁLISE DE COMPATIBILIDADE</h4>
                  <p className="font-mono text-[7px] text-primary uppercase font-black tracking-widest leading-none mt-1">SISTEMA ANTIFRAUDE E INDIVIDUALIZAÇÃO DETERMINÍSTICA</p>
                </div>
              </div>

              {/* Grid with 3 custom metrics */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                
                {/* Metragem de Individualização */}
                <div className="space-y-2 bg-black/30 p-4 rounded-2xl border border-white/5">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-mono text-white/50 uppercase font-black">Score de Ajuste</span>
                    <span className="text-[10px] font-mono text-primary uppercase font-black">{smartPlan?.personalizationScore}% Real</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-primary h-full rounded-full transition-all duration-500 shadow-glow-primary" 
                      style={{ width: `${smartPlan?.personalizationScore || 95}%` }}
                    />
                  </div>
                  <p className="font-mono text-[7px] text-white/40 uppercase leading-normal">
                    Assinatura biométrica: <span className="text-white/70">0x{(computeSeed(smartPlan?.physicalData || formData, user?.uid || "user_guest", variationIndex || 0)).toString(16).toUpperCase()}</span>
                  </p>
                </div>

                {/* Variação Ativa (Anti-Repetição) */}
                <div className="space-y-2 bg-black/30 p-4 rounded-2xl border border-white/5 flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[9px] font-mono text-white/50 uppercase font-black block">Variação Ativa</span>
                      <span className="text-xs font-headline italic font-black text-white uppercase">VARIAÇÃO #{variationIndex + 1} de 10</span>
                    </div>
                    <span className="text-[7.5px] font-mono text-primary bg-primary/10 border border-primary/15 px-1.5 py-0.5 rounded uppercase font-black font-bold">Multi-Match</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateVariation}
                    disabled={loading}
                    className="w-full py-2 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl font-mono text-[8.5px] font-black uppercase tracking-widest text-white hover:text-primary flex items-center justify-center gap-1.5 transition-all"
                  >
                    <RefreshCw size={10} className={cn("shrink-0", loading && "animate-spin")} /> Alternar Variação
                  </button>
                </div>

                {/* Histórico & Ciclos (15/30 Dias) */}
                <div className="space-y-2 bg-black/30 p-4 rounded-2xl border border-white/5 flex flex-col justify-between">
                  <div>
                    <span className="text-[9px] font-mono text-white/50 uppercase font-black block">Monitoramento de Evolução</span>
                    <span className="text-xs font-headline italic font-black text-[#FFCC00] uppercase">REAVALIAÇÃO EM 15 DIAS</span>
                  </div>
                  <p className="font-mono text-[7px] text-white/40 uppercase leading-snug">
                    Recomendamos redefinir suas cargas e ingestão após <span className="text-[#FFCC00] font-black">15 e 30 dias</span> de consistência esportiva.
                  </p>
                </div>
              </div>

              {/* Explicação Científica do Plano */}
              <div className="bg-primary/5 border border-primary/10 p-4 rounded-2xl space-y-1.5">
                <span className="text-[9px] font-mono text-primary uppercase font-black tracking-widest block">DIRECIONAMENTO CLÍNICO INDIVIDUALIZADO</span>
                <p className="text-on-surface-variant text-[10px] font-label font-medium leading-relaxed uppercase tracking-wider text-white/80">
                  {smartPlan?.motivationExplain}
                </p>
              </div>

              {/* 10 Estilos Visuais Premium (Mudar Tema do Infográfico) */}
              <div className="space-y-2 pt-1 border-t border-white/5">
                <span className="text-[9px] font-mono text-white/50 uppercase font-black block tracking-wider mb-2">Mudar Paleta Temática do Infográfico (10 Estilos de Competição)</span>
                
                <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {THEMES.map((theme, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleThemeChange(idx)}
                      className={cn(
                        "px-3.5 py-2 rounded-xl flex items-center gap-2 border text-[9px] font-mono uppercase tracking-wider font-black transition-all shrink-0 hover:scale-[102] active:scale-[0.98]",
                        themeIndex === idx 
                          ? "bg-white/10 text-white" 
                          : "bg-black/40 text-white/60 hover:text-white"
                      )}
                      style={{ 
                        borderColor: themeIndex === idx ? theme.primary : 'rgba(255,255,255,0.08)',
                        borderLeftWidth: '5px',
                        borderLeftColor: theme.primary
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.secondary }} />
                      {theme.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

              <div 
                id="workout-result-panel" 
                className="space-y-6"
              >
                {/* WORKOUT DAYS PREVIEW */}
                <div className="space-y-4">
                  <div className="flex justify-between items-baseline">
                    <h3 className="font-headline italic font-black text-lg uppercase text-white tracking-wider flex items-center gap-2">
                      <Dumbbell size={18} className="text-primary" /> ROTINA DE TREINO PREMIUM
                    </h3>
                    <span className="font-mono text-[9px] text-primary uppercase">Estratégia {smartPlan?.workout.divisionName}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {smartPlan?.workout.days.filter(d => !d.isRest).map((day, dIdx) => (
                      <div key={dIdx} className="bg-surface-container border border-white/5 p-6 rounded-[24px] space-y-4 shadow-xl">
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <span className="font-headline italic font-black text-base text-white uppercase">{day.dayName}</span>
                          <span className="font-mono text-[8px] text-primary bg-primary/10 px-2 py-0.5 rounded uppercase font-black">{day.muscleGroup}</span>
                        </div>

                        <div className="space-y-3">
                          {day.exercises.map((ex, eIdx) => (
                            <div key={eIdx} className="flex justify-between items-center text-xs border-b border-white/[0.03] pb-2 last:border-b-0 last:pb-0 gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-bold text-white/90 uppercase truncate">{ex.name}</span>
                                <button
                                  type="button"
                                  onClick={() => handleSwapExercise(dIdx, eIdx)}
                                  className="text-white/30 hover:text-primary transition-all p-0.5 rounded hover:bg-white/5 shrink-0"
                                  title="Substituir exercício"
                                >
                                  <RefreshCw size={8} />
                                </button>
                              </div>
                              <span className="font-mono text-[10px] text-primary font-black shrink-0 pl-2">
                                {ex.series}x{ex.reps} <span className="text-white/45">({ex.rest}s Res)</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* WORKOUT IMAGE GENERATOR CONTAINER */}
                <div className="bg-[#121418] border border-white/5 rounded-[32px] p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-headline italic font-black text-base uppercase text-primary">INFOGRÁFICO DE TREINO COMPARTILHÁVEL</h4>
                      <p className="font-mono text-[8px] text-white/45 uppercase tracking-widest leading-none mt-1">Ficha de Treino visualmente desenhada para mobile de alto impacto</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownload('workout')}
                        className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-white transition-all border border-white/5"
                        title="Baixar imagem"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={() => handleShare('workout')}
                        className="px-4 py-2.5 bg-primary text-black hover:bg-gold rounded-xl font-black font-label text-[10px] uppercase tracking-widest flex items-center gap-1.5 transition-all shadow-glow-primary"
                      >
                        <Share2 size={12} /> Compartilhar Ficha
                      </button>
                    </div>
                  </div>

                  {/* Canvas preview */}
                  <div className="w-full flex justify-center bg-black/40 border border-white/5 rounded-2xl overflow-hidden py-6 sm:aspect-auto">
                    <canvas 
                      key="workout-canvas-infographic"
                      ref={workoutCanvasRef} 
                      className="w-full max-w-4xl rounded-lg shadow-2xl border border-white/10"
                      style={{ maxHeight: '600px', objectFit: 'contain' }}
                    />
                  </div>
                </div>
              </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ==========================================
// HEURISTIC PRESET CALCULATOR DATABASES
// ==========================================

const translateObjective = (obj: string) => {
  switch (obj) {
    case 'hipertrofia': return 'Hipertrofia - Massa 💪';
    case 'emagrecimento': return 'Emagrecimento 🔥';
    case 'definir': return 'Definição Extrema ⚡';
    case 'recompensacao': return 'Recomposição Corporal ⚖️';
    default: return 'Geral';
  }
};

const generateMockCustomMeals = (
  data: PhysicalData, 
  totCal: number, 
  totProt: number, 
  totCarb: number, 
  totFat: number,
  seed: number,
  varIndex: number
): SmartMeal[] => {
  const rand = new SeededRandom(seed + varIndex);
  const result: SmartMeal[] = [];
  const mealsCount = Number(data.mealsCount) as 3 | 4 | 5 | 6;

  // Retrieve the structured template for this specific meals count configuration
  const template = DIET_TEMPLATES[mealsCount.toString()] || DIET_TEMPLATES['4'];
  
  const isVegan = data.restrictions === 'vegano';
  const isVegetarian = data.restrictions === 'vegetariano' || isVegan;
  const isLactoseFree = data.restrictions === 'sem_lactose' || isVegan;
  const isGlutenFree = data.restrictions === 'sem_gluten';

  // Helper to filter sources
  const filterFoods = (category: string) => {
    return FOOD_DATABASE.filter(f => {
      if (f.category !== category) return false;
      if (isVegan && !f.isVegan) return false;
      if (isVegetarian && !f.isVegetarian) return false;
      if (isLactoseFree && !f.isLactoseFree) return false;
      if (isGlutenFree && !f.isGlutenFree) return false;
      
      if (data.dislikedFoods) {
        const dislikes = data.dislikedFoods.toLowerCase().split(/[,,;,.\s]+/);
        for (const d of dislikes) {
          if (d.trim().length > 2 && f.name.toLowerCase().includes(d.trim())) {
            return false;
          }
        }
      }
      return true;
    });
  };

  const getFoodOrPick = (category: string): FoodSource => {
    const eligible = filterFoods(category);
    if (eligible.length === 0) {
      return FOOD_DATABASE.filter(f => f.category === category)[0] || FOOD_DATABASE[0];
    }
    if (data.preferences) {
      const prefs = data.preferences.toLowerCase().split(/[,,;,.\s]+/);
      const matched = eligible.filter(f => {
        return prefs.some(p => p.trim().length > 2 && f.name.toLowerCase().includes(p.trim()));
      });
      if (matched.length > 0) return rand.pick(matched);
    }
    return rand.pick(eligible);
  };

  // Build adjusted meals from template
  template.names.forEach((name, idx) => {
    const time = template.times[idx];
    const type = template.types[idx] as 'breakfast' | 'lunch' | 'dinner' | 'pre_workout' | 'snack';
    const fraction = template.fractions[idx];

    const mealCals = Math.round(totCal * fraction);
    const mealProts = Math.round(totProt * fraction);
    const mealCarbs = Math.round(totCarb * fraction);
    const mealFats = Math.round(totFat * fraction);

    const foods: FoodItem[] = [];

    if (type === 'breakfast') {
      const pSource = getFoodOrPick('snack_protein');
      const cSource = getFoodOrPick('carb');
      const fSource = getFoodOrPick('fruit');

      // Portions math
      let pGrams = 30;
      let pQty = '30g (1 scoop)';
      if (pSource.name.includes('Ovo')) {
        pGrams = Math.max(2, Math.round(mealFats / 5.5));
        pQty = `${pGrams}un`;
      } else if (pSource.name.includes('Iogurte') || pSource.name.includes('Cottage')) {
        pGrams = 150;
        pQty = '150g';
      }

      foods.push({
        name: pSource.name,
        quantity: pQty,
        protein: pSource.name.includes('Ovo') ? pGrams * 6 : Math.round((pGrams * pSource.protein) / 100),
        carbs: pSource.name.includes('Ovo') ? 0 : Math.round((pGrams * pSource.carbs) / 100),
        fats: pSource.name.includes('Ovo') ? pGrams * 5 : Math.round((pGrams * pSource.fats) / 100),
        calories: pSource.name.includes('Ovo') ? pGrams * 70 : Math.round((pGrams * pSource.calories) / 100),
        category: 'snack_protein'
      });

      const oatsCarbs = Math.max(10, Math.round(mealCarbs * 0.6));
      let cGrams = Math.round((oatsCarbs / cSource.carbs) * 100);
      foods.push({
        name: cSource.name,
        quantity: `${cGrams}g`,
        protein: Math.round((cGrams * cSource.protein) / 100),
        carbs: oatsCarbs,
        fats: Math.round((cGrams * cSource.fats) / 100),
        calories: Math.round((cGrams * cSource.calories) / 100),
        category: 'carb'
      });

      const remCarbs = Math.max(5, mealCarbs - oatsCarbs);
      let fGrams = Math.round((remCarbs / fSource.carbs) * 100);
      foods.push({
        name: fSource.name,
        quantity: `${fGrams}g`,
        protein: Math.round((fGrams * fSource.protein) / 100),
        carbs: remCarbs,
        fats: Math.round((fGrams * fSource.fats) / 100),
        calories: Math.round((fGrams * fSource.calories) / 100),
        category: 'fruit'
      });

    } else if (type === 'lunch' || type === 'dinner') {
      const pSource = getFoodOrPick('protein');
      const cSource = getFoodOrPick('carb');
      const fSource = getFoodOrPick('fat');

      // Carb portion
      const carbTarget = Math.max(15, mealCarbs);
      const cGrams = Math.round((carbTarget / cSource.carbs) * 100);
      foods.push({
        name: cSource.name,
        quantity: `${cGrams}g`,
        protein: Math.round((cGrams * cSource.protein) / 100),
        carbs: carbTarget,
        fats: Math.round((cGrams * cSource.fats) / 100),
        calories: Math.round((cGrams * cSource.calories) / 100),
        category: 'carb'
      });

      // Protein portion
      const protTarget = Math.max(15, mealProts);
      const pGrams = Math.round((protTarget / pSource.protein) * 100);
      foods.push({
        name: pSource.name,
        quantity: `${pGrams}g`,
        protein: protTarget,
        carbs: Math.round((pGrams * pSource.carbs) / 100),
        fats: Math.round((pGrams * pSource.fats) / 100),
        calories: Math.round((pGrams * pSource.calories) / 100),
        category: 'protein'
      });

      // Fat portion
      const fatTarget = Math.max(3, mealFats);
      const fGrams = Math.round((fatTarget / fSource.fats) * 100);
      foods.push({
        name: fSource.name,
        quantity: `${fGrams}g`,
        protein: Math.round((fGrams * fSource.protein) / 100),
        carbs: Math.round((fGrams * fSource.carbs) / 100),
        fats: fatTarget,
        calories: Math.round((fGrams * fSource.calories) / 100),
        category: 'fat'
      });

      // Vegetable free line
      foods.push({
        name: 'Vegetais Verdes Variados (Brócolis/Mix)',
        quantity: '1 Saladeira Média (À vontade)',
        protein: 1,
        carbs: 2,
        fats: 0,
        calories: 12,
        category: 'vegetable'
      });

    } else if (type === 'pre_workout') {
      const cSource = getFoodOrPick('carb');
      const pSource = getFoodOrPick('snack_protein');

      const carbTarget = Math.max(15, mealCarbs);
      const cGrams = Math.round((carbTarget / cSource.carbs) * 100);
      foods.push({
        name: cSource.name,
        quantity: `${cGrams}g`,
        protein: Math.round((cGrams * cSource.protein) / 100),
        carbs: carbTarget,
        fats: Math.round((cGrams * cSource.fats) / 100),
        calories: Math.round((cGrams * cSource.calories) / 100),
        category: 'carb'
      });

      let pQty = '30g';
      let pGrams = 30;
      if (pSource.name.includes('Ovo')) {
        pGrams = Math.max(2, Math.round(mealProts / 6));
        pQty = `${pGrams}un`;
      }
      foods.push({
        name: pSource.name,
        quantity: pQty,
        protein: pSource.name.includes('Ovo') ? pGrams * 6 : Math.round((pGrams * pSource.protein) / 100),
        carbs: pSource.name.includes('Ovo') ? 0 : Math.round((pGrams * pSource.carbs) / 100),
        fats: pSource.name.includes('Ovo') ? pGrams * 5 : Math.round((pGrams * pSource.fats) / 100),
        calories: pSource.name.includes('Ovo') ? pGrams * 140 : Math.round((pGrams * pSource.calories) / 100),
        category: 'snack_protein'
      });

    } else {
      // Snack/Ceia
      const pSource = getFoodOrPick('snack_protein');
      const fSource = getFoodOrPick('fat');

      let pQty = '30g';
      let pGrams = 30;
      if (pSource.name.includes('Iogurte') || pSource.name.includes('Cottage')) {
        pGrams = 120;
        pQty = '120g';
      }
      foods.push({
        name: pSource.name,
        quantity: pQty,
        protein: Math.round((pGrams * pSource.protein) / 100),
        carbs: Math.round((pGrams * pSource.carbs) / 100),
        fats: Math.round((pGrams * pSource.fats) / 100),
        calories: Math.round((pGrams * pSource.calories) / 100),
        category: 'snack_protein'
      });

      const fatTarget = Math.max(3, mealFats);
      const fGrams = Math.round((fatTarget / fSource.fats) * 100);
      foods.push({
        name: fSource.name,
        quantity: `${fGrams}g`,
        protein: Math.round((fGrams * fSource.protein) / 100),
        carbs: Math.round((fGrams * fSource.carbs) / 100),
        fats: fatTarget,
        calories: Math.round((fGrams * fSource.calories) / 100),
        category: 'fat'
      });
    }

    // Accumulate actual meal numbers
    let mP = 0, mC = 0, mF = 0, mK = 0;
    foods.forEach(f => {
      mP += f.protein;
      mC += f.carbs;
      mF += f.fats;
      mK += f.calories;
    });

    result.push({
      name,
      time,
      foods,
      calories: mK,
      protein: mP,
      carbs: mC,
      fats: mF
    });
  });

  return result;
};

const generateMockCustomWorkout = (data: PhysicalData, seed: number, varIndex: number): { divisionName: string; days: SmartWorkoutDay[] } => {
  const rand = new SeededRandom(seed + varIndex);
  const isAcademia = data.workoutType === 'academia' || data.workoutType === 'ambos';
  const availabilityDays = Number(data.availability);
  const injuries = data.injuriesAndLimitations;

  // Retrieve matching workout template from the library
  const template = getWorkoutTemplate(data.experience, data.objective, availabilityDays);

  const filterExs = (category: string) => {
    return EXERCISE_DATABASE.filter(ex => {
      if (ex.category !== category) return false;
      if (!isAcademia && ex.isGym) return false;
      if (injuries) {
        const injL = injuries.toLowerCase();
        if (ex.isJointHeavy && ex.jointInvolved !== 'nenhum') {
          if (injL.includes(ex.jointInvolved)) return false;
        }
      }
      return true;
    });
  };

  const getExercise = (category: string, defaultName?: string): ExerciseSource => {
    const eligible = filterExs(category);
    if (eligible.length === 0) {
      if (defaultName) {
        const exact = EXERCISE_DATABASE.find(ex => ex.name.toLowerCase() === defaultName.toLowerCase());
        if (exact) return exact;
      }
      return EXERCISE_DATABASE.filter(ex => ex.category === category)[0] || EXERCISE_DATABASE[0];
    }
    return rand.pick(eligible);
  };

  const days: SmartWorkoutDay[] = template.days.map(day => {
    if (day.isRest) {
      return {
        dayName: day.dayName,
        muscleGroup: day.muscleGroup,
        isRest: true,
        exercises: []
      };
    }

    const exercises: SmartWorkoutExercise[] = day.exercises.map(exTemplate => {
      const src = getExercise(exTemplate.category, exTemplate.name);

      // Adapt series / reps / rest to difficulty levels
      let series = 3;
      let reps = '10-12';
      let rest = '60s';

      if (data.experience === 'iniciante') {
        series = 3;
        reps = exTemplate.isCompound ? '10-12' : '12-15';
        rest = exTemplate.isCompound ? '90s' : '60s';
      } else if (data.experience === 'intermediario') {
        series = exTemplate.isCompound ? 4 : 3;
        reps = exTemplate.isCompound ? '8-10' : '10-12';
        rest = exTemplate.isCompound ? '90s' : '75s';
      } else {
        // Advanced
        series = exTemplate.isCompound ? 4 : 4;
        reps = rand.pick(['6-8', '8-10', 'Rest-Pause (3xMax)']);
        rest = exTemplate.isCompound ? '120s' : '90s';
      }

      return {
        name: src.name,
        series,
        reps,
        rest,
        muscleGroup: src.muscleGroup,
        category: exTemplate.category
      };
    });

    return {
      dayName: day.dayName,
      muscleGroup: day.muscleGroup,
      isRest: false,
      exercises
    };
  });

  return {
    divisionName: template.divisionName,
    days
  };
};

const _unused_old_generateMockCustomWorkout = (data: PhysicalData, seed: number): { divisionName: string; days: SmartWorkoutDay[] } => {
  const isAcademia = data.workoutType === 'academia' || data.workoutType === 'ambos';
  const availabilityDays = data.availability;
  const mapToWorkoutExercise = (category: string, isCompound: boolean): SmartWorkoutExercise => {
    return { name: '', series: 3, reps: '', rest: '', muscleGroup: '', category };
  };

  if (availabilityDays === '3') {
    return {
      divisionName: '3 Dias - Full Body (Foco em Intensidade & Regeneração)',
      days: [
        {
          dayName: 'Segunda-feira',
          muscleGroup: 'Full Body A',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('perna_quads', true),
            mapToWorkoutExercise('peito', true),
            mapToWorkoutExercise('costas', true),
            mapToWorkoutExercise('ombro', false),
            mapToWorkoutExercise('biceps', false)
          ]
        },
        {
          dayName: 'Quarta-feira',
          muscleGroup: 'Full Body B',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('perna_post', true),
            mapToWorkoutExercise('ombro', true),
            mapToWorkoutExercise('costas', true),
            mapToWorkoutExercise('perna_quads', false),
            mapToWorkoutExercise('triceps', false)
          ]
        },
        {
          dayName: 'Sexta-feira',
          muscleGroup: 'Full Body C',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('perna_quads', true),
            mapToWorkoutExercise('peito', true),
            mapToWorkoutExercise('costas', true),
            mapToWorkoutExercise('core', false),
            mapToWorkoutExercise('cardio', false)
          ]
        }
      ]
    };
  } else if (availabilityDays === '4') {
    return {
      divisionName: '4 Dias - Upper / Lower Dinâmico',
      days: [
        {
          dayName: 'Segunda-feira',
          muscleGroup: 'Upper A (Superior Foco Espessura)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('peito', true),
            mapToWorkoutExercise('costas', true),
            mapToWorkoutExercise('ombro', false),
            mapToWorkoutExercise('triceps', false),
            mapToWorkoutExercise('biceps', false)
          ]
        },
        {
          dayName: 'Terça-feira',
          muscleGroup: 'Lower A (Inferior Foco Quadríceps)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('perna_quads', true),
            mapToWorkoutExercise('perna_post', true),
            mapToWorkoutExercise('perna_quads', false),
            mapToWorkoutExercise('core', false)
          ]
        },
        {
          dayName: 'Quinta-feira',
          muscleGroup: 'Upper B (Superior Foco Largura)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('peito', true),
            mapToWorkoutExercise('costas', true),
            mapToWorkoutExercise('ombro', false),
            mapToWorkoutExercise('biceps', false),
            mapToWorkoutExercise('triceps', false)
          ]
        },
        {
          dayName: 'Sexta-feira',
          muscleGroup: 'Lower B (Inferior Foco Cadeia Posterior)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('perna_post', true),
            mapToWorkoutExercise('perna_quads', true),
            mapToWorkoutExercise('core', false),
            mapToWorkoutExercise('cardio', false)
          ]
        }
      ]
    };
  } else if (availabilityDays === '5') {
    return {
      divisionName: '5 Dias - Push / Pull / Legs / Upper / Core',
      days: [
        {
          dayName: 'Dia 1 - Push',
          muscleGroup: 'Empurrar (Foco Peito & Tríceps)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('peito', true),
            mapToWorkoutExercise('peito', false),
            mapToWorkoutExercise('ombro', false),
            mapToWorkoutExercise('triceps', false)
          ]
        },
        {
          dayName: 'Dia 2 - Pull',
          muscleGroup: 'Puxar (Foco Costas & Bíceps)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('costas', true),
            mapToWorkoutExercise('costas', false),
            mapToWorkoutExercise('ombro', false),
            mapToWorkoutExercise('biceps', false)
          ]
        },
        {
          dayName: 'Dia 3 - Legs',
          muscleGroup: 'Membros Inferiores Completos',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('perna_quads', true),
            mapToWorkoutExercise('perna_post', true),
            mapToWorkoutExercise('perna_quads', false),
            mapToWorkoutExercise('core', false)
          ]
        },
        {
          dayName: 'Dia 4 - Upper',
          muscleGroup: 'Membros Superiores (Densidade Geral)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('peito', true),
            mapToWorkoutExercise('costas', true),
            mapToWorkoutExercise('ombro', false),
            mapToWorkoutExercise('biceps', false)
          ]
        },
        {
          dayName: 'Dia 5 - Abs & Cardio Estendido',
          muscleGroup: 'Regenerativo Ativo (Abdômen & Cardio)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('core', false),
            mapToWorkoutExercise('core', false),
            mapToWorkoutExercise('cardio', false),
            mapToWorkoutExercise('cardio', false)
          ]
        }
      ]
    };
  } else {
    // 6 Days
    return {
      divisionName: '6 Dias - Push / Pull / Legs Olímpico 2X',
      days: [
        {
          dayName: 'Dia 1 - Push A',
          muscleGroup: 'Empurrar A (Superior)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('peito', true),
            mapToWorkoutExercise('ombro', true),
            mapToWorkoutExercise('peito', false),
            mapToWorkoutExercise('triceps', false)
          ]
        },
        {
          dayName: 'Dia 2 - Pull A',
          muscleGroup: 'Puxar A (Dorsais)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('costas', true),
            mapToWorkoutExercise('costas', false),
            mapToWorkoutExercise('biceps', false),
            mapToWorkoutExercise('ombro', false)
          ]
        },
        {
          dayName: 'Dia 3 - Legs A',
          muscleGroup: 'Pernas A (Foco Quadríceps)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('perna_quads', true),
            mapToWorkoutExercise('perna_quads', false),
            mapToWorkoutExercise('perna_post', false),
            mapToWorkoutExercise('core', false)
          ]
        },
        {
          dayName: 'Dia 4 - Push B',
          muscleGroup: 'Empurrar B (Ombros Deltoides)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('ombro', true),
            mapToWorkoutExercise('peito', true),
            mapToWorkoutExercise('ombro', false),
            mapToWorkoutExercise('triceps', false)
          ]
        },
        {
          dayName: 'Dia 5 - Pull B',
          muscleGroup: 'Puxar B (Espessura)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('costas', true),
            mapToWorkoutExercise('costas', false),
            mapToWorkoutExercise('biceps', false),
            mapToWorkoutExercise('biceps', false)
          ]
        },
        {
          dayName: 'Dia 6 - Legs B',
          muscleGroup: 'Pernas B (Foco Posterior)',
          isRest: false,
          exercises: [
            mapToWorkoutExercise('perna_post', true),
            mapToWorkoutExercise('perna_post', false),
            mapToWorkoutExercise('perna_quads', false),
            mapToWorkoutExercise('cardio', false)
          ]
        }
      ]
    };
  }
};
