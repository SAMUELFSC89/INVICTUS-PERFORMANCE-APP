import { e, type ExpansionDefinition } from './shared';

export const CORE_EXPANSION: ExpansionDefinition[] = [
  e("bicycle_crunch", "Abdominal Bicicleta", "core", "peso corporal", [], "core"),
  e("cable_woodchop_high_to_low", "Woodchop no Cabo de Cima para Baixo", "core", "polia alta", ["crossover"], "core"),
  e("cable_woodchop_low_to_high", "Woodchop no Cabo de Baixo para Cima", "core", "polia baixa", ["crossover"], "core"),
  e("captains_chair_knee_raise", "Elevação de Joelhos na Cadeira Romana", "core", "cadeira romana", ["maquinas"], "core"),
  e("dumbbell_suitcase_carry", "Caminhada Suitcase com Halter", "core", "halter", ["halteres"], "core"),
  e("front_plank", "Prancha Frontal", "core", "peso corporal", [], "core"),
  e("half_kneeling_cable_pallof_press", "Pallof Press Meio-Ajoelhado", "core", "polia e puxador individual", ["crossover"], "core"),
  e("hanging_knee_raise", "Elevação de Joelhos na Barra", "core", "barra fixa", ["barra_fixa"], "core"),
  e("hanging_leg_raise", "Elevação de Pernas na Barra", "core", "barra fixa", ["barra_fixa"], "core"),
  e("heel_taps", "Toque nos Calcanhares", "core", "peso corporal", [], "core"),
  e("hollow_body_hold", "Hollow Body Hold", "core", "peso corporal", [], "core"),
  e("kneeling_cable_pallof_press", "Pallof Press Ajoelhado no Cabo", "core", "polia e puxador individual", ["crossover"], "core"),
  e("mountain_climber", "Escalador", "core", "peso corporal", [], "core"),
  e("plank_shoulder_tap", "Prancha com Toque nos Ombros", "core", "peso corporal", [], "core"),
  e("russian_twist", "Rotação Russa", "core", "peso corporal", [], "core"),
  e("side_plank", "Prancha Lateral", "core", "peso corporal", [], "core"),
  e("v_up", "Abdominal V-Up", "core", "peso corporal", [], "core"),
  e("weighted_plank", "Prancha com Sobrecarga", "core", "anilha e peso corporal", ["barra_anilhas"], "core"),
];
