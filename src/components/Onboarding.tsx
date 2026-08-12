import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, ChevronLeft, Check, Dumbbell, Target, User, Ruler, Calendar, Heart, Star, MapPin } from 'lucide-react';
import { UserProfile, Sex, WorkoutFrequency, TrainingObjective, BodySelfAssessment } from '../types';
import { fitnessService } from '../services/fitnessService';
import { userService } from '../services/userService';
import { cn } from '../lib/utils';

interface OnboardingProps {
  user: UserProfile;
  onComplete: () => void;
}

type StepId = 'username' | 'sex_age' | 'body' | 'frequency' | 'objective' | 'assessment' | 'gym';

export function Onboarding({ user, onComplete }: OnboardingProps) {
  const activeSteps = useMemo<StepId[]>(() => {
    const steps: StepId[] = [];

    // 1. Username / Apelido
    if (!user.username) {
      steps.push('username');
    }

    // 2. Sexo e Idade
    if (!user.sex || !user.age || user.age === 0) {
      steps.push('sex_age');
    }

    // 3. Medidas (Peso e Altura)
    if (!user.weight || !user.height || user.weight === 0 || user.height === 0) {
      steps.push('body');
    }

    // 4. Frequência Semanal
    if (!user.weeklyFrequency) {
      steps.push('frequency');
    }

    // 5. Objetivo
    if (!user.objective) {
      steps.push('objective');
    }

    // 6. Autoavaliação
    if (!user.bodySelfAssessment) {
      steps.push('assessment');
    }

    // 7. Academia / Arena
    if (!user.gymId) {
      steps.push('gym');
    }

    return steps;
  }, [user]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeSteps.length === 0) {
      onComplete();
    }
  }, [activeSteps, onComplete]);

  const currentStepId = activeSteps[currentStepIndex] || 'gym';
  const totalSteps = activeSteps.length || 1;
  const currentStepNumber = currentStepIndex + 1;
  
  const [formData, setFormData] = useState({
    username: user.username || '',
    gymId: user.gymId || '',
    gymName: user.gymName || '',
    gymLocation: user.gymLocation || null as { lat: number; lng: number } | null,
    weight: user.weight || 70,
    height: user.height || 170,
    age: user.age || 25,
    sex: user.sex || 'male' as Sex,
    weeklyFrequency: user.weeklyFrequency || '3-4' as WorkoutFrequency,
    objective: user.objective || 'emagrecer' as TrainingObjective,
    bodySelfAssessment: user.bodySelfAssessment || 'normal' as BodySelfAssessment,
    dietaryRestrictions: user.dietaryRestrictions || [],
    dietaryPreference: user.dietaryPreference || 'simples'
  });

  const [nearbyGyms, setNearbyGyms] = useState<any[]>([]);
  const [gymLoading, setGymLoading] = useState(false);
  const [gymError, setGymError] = useState<string | null>(null);

  useEffect(() => {
    if (currentStepId === 'gym') {
      loadNearbyGyms();
    }
  }, [currentStepId]);

  const loadNearbyGyms = async () => {
    setGymLoading(true);
    setGymError(null);
    try {
      const { getCurrentLocation } = await import('../lib/locationUtils');
      const loc = await getCurrentLocation(true);
      
      const { gymService } = await import('../services/gymService');
      const gyms = await gymService.searchNearbyGyms(loc.lat, loc.lng);
      setNearbyGyms(gyms);
    } catch (error: any) {
      console.error('Failed to load nearby gyms:', error);
      setGymError(error.message || 'Erro ao localizar academias. Tente novamente.');
    } finally {
      setGymLoading(false);
    }
  };

  const handleNext = () => {
    if (currentStepId === 'username' && !formData.username) {
      alert('Escolha um apelido!');
      return;
    }
    if (currentStepId === 'gym' && !formData.gymId) {
      alert('Selecione sua academia!');
      return;
    }
    if (currentStepIndex < totalSteps - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const imc = fitnessService.calculateIMC(formData.weight, formData.height);
      const league = fitnessService.classifyLeague(imc, formData.weeklyFrequency, formData.bodySelfAssessment);
      const calories = fitnessService.calculateDailyCalories(
        formData.weight, 
        formData.height, 
        formData.age, 
        formData.sex, 
        formData.weeklyFrequency, 
        formData.objective
      );
      const macros = fitnessService.calculateMacros(calories, formData.objective, formData.weight);

      await userService.updateProfile({
        ...formData,
        displayNameLower: formData.username.toLowerCase(),
        imc,
        league,
        dailyCalories: calories,
        macros,
        termsAccepted: true,
        termsAcceptedAt: new Date().toISOString(),
        seasonStartedAt: new Date().toISOString(),
        lastSeasonResetAt: new Date().toISOString()
      });
      onComplete();
    } catch (error) {
      console.error('Failed to save onboarding:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-background flex flex-col">
      {/* Progress Bar */}
      <div className="w-full h-1 bg-surface-container-highest">
        <motion.div 
          className="h-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${(currentStepNumber / totalSteps) * 100}%` }}
        />
      </div>

      <main className="flex-grow flex flex-col items-center justify-center px-6 py-12 max-w-md mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStepId}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="w-full space-y-8"
          >
            {currentStepId === 'username' && (
              <div className="space-y-6">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                  <Star size={32} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-headline italic font-black text-4xl uppercase tracking-tighter">SUA IDENTIDADE</h2>
                  <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest">Como quer ser chamado nas ligas?</p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest">APELIDO (ÚNICO)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-primary font-headline italic font-black opacity-40">@</span>
                      <input
                        type="text"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 15) })}
                        placeholder="atleta_fatal"
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-4 pl-10 font-headline italic text-2xl text-on-surface outline-none focus:border-primary uppercase"
                      />
                    </div>
                    <p className="text-[9px] font-bold text-on-surface-variant/60 uppercase">Mínimo 3 caracteres, apenas letras e números.</p>
                  </div>
                </div>
              </div>
            )}

            {currentStepId === 'sex_age' && (
              <div className="space-y-6">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                  <User size={32} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-headline italic font-black text-4xl uppercase tracking-tighter">VAMOS COMEÇAR</h2>
                  <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest">Qual o seu sexo e idade?</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setFormData({ ...formData, sex: 'male' })}
                    className={cn(
                      "p-6 rounded-2xl border-2 transition-all flex flex-col items-center gap-2",
                      formData.sex === 'male' ? "bg-primary/10 border-primary text-primary" : "bg-surface-container-low border-outline-variant/10 text-on-surface-variant"
                    )}
                  >
                    <span className="font-headline italic font-black text-xl">HOMEM</span>
                  </button>
                  <button
                    onClick={() => setFormData({ ...formData, sex: 'female' })}
                    className={cn(
                      "p-6 rounded-2xl border-2 transition-all flex flex-col items-center gap-2",
                      formData.sex === 'female' ? "bg-primary/10 border-primary text-primary" : "bg-surface-container-low border-outline-variant/10 text-on-surface-variant"
                    )}
                  >
                    <span className="font-headline italic font-black text-xl">MULHER</span>
                  </button>
                </div>
                <div className="space-y-2">
                  <label className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest">IDADE</label>
                  <input
                    type="number"
                    value={isNaN(formData.age) ? '' : formData.age}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setFormData({ ...formData, age: isNaN(val) ? '' as any : val });
                    }}
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-4 font-headline italic text-2xl text-on-surface outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}

            {currentStepId === 'body' && (
              <div className="space-y-6">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                  <Ruler size={32} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-headline italic font-black text-4xl uppercase tracking-tighter">MEDIDAS</h2>
                  <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest">Seu peso e altura atuais</p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest">PESO (KG)</label>
                    <input
                      type="number"
                      value={isNaN(formData.weight) ? '' : formData.weight}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setFormData({ ...formData, weight: isNaN(val) ? '' as any : val });
                      }}
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-4 font-headline italic text-2xl text-on-surface outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest">ALTURA (CM)</label>
                    <input
                      type="number"
                      value={isNaN(formData.height) ? '' : formData.height}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setFormData({ ...formData, height: isNaN(val) ? '' as any : val });
                      }}
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-4 font-headline italic text-2xl text-on-surface outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </div>
            )}

            {currentStepId === 'frequency' && (
              <div className="space-y-6">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                  <Dumbbell size={32} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-headline italic font-black text-4xl uppercase tracking-tighter">ROTINA</h2>
                  <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest">Quantas vezes você treina por semana?</p>
                  <div className="bg-primary/5 p-4 rounded-xl border border-primary/10">
                    <p className="text-primary text-[10px] font-black uppercase tracking-widest leading-tight">
                      "Você vai competir com pessoas do seu nível. Aqui a disputa é justa — todos têm chance real."
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  {(['0-2', '3-4', '5+'] as WorkoutFrequency[]).map((freq) => (
                    <button
                      key={freq}
                      onClick={() => setFormData({ ...formData, weeklyFrequency: freq })}
                      className={cn(
                        "w-full p-6 rounded-2xl border-2 transition-all flex justify-between items-center",
                        formData.weeklyFrequency === freq ? "bg-primary/10 border-primary text-primary" : "bg-surface-container-low border-outline-variant/10 text-on-surface-variant"
                      )}
                    >
                      <span className="font-headline italic font-black text-xl uppercase">{freq} DIAS</span>
                      {formData.weeklyFrequency === freq && <Check size={20} />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {currentStepId === 'objective' && (
              <div className="space-y-6">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                  <Target size={32} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-headline italic font-black text-4xl uppercase tracking-tighter">OBJETIVO</h2>
                  <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest">O que você busca alcançar?</p>
                </div>
                <div className="space-y-3">
                  {[
                    { id: 'emagrecer', label: 'EMAGRECER' },
                    { id: 'ganhar_massa', label: 'GANHAR MASSA' },
                    { id: 'definir', label: 'DEFINIR' }
                  ].map((obj) => (
                    <button
                      key={obj.id}
                      onClick={() => setFormData({ ...formData, objective: obj.id as TrainingObjective })}
                      className={cn(
                        "w-full p-6 rounded-2xl border-2 transition-all flex justify-between items-center",
                        formData.objective === obj.id ? "bg-primary/10 border-primary text-primary" : "bg-surface-container-low border-outline-variant/10 text-on-surface-variant"
                      )}
                    >
                      <span className="font-headline italic font-black text-xl uppercase">{obj.label}</span>
                      {formData.objective === obj.id && <Check size={20} />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {currentStepId === 'assessment' && (
              <div className="space-y-6">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                  <Heart size={32} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-headline italic font-black text-4xl uppercase tracking-tighter">AUTOAVALIAÇÃO</h2>
                  <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest">Como você vê seu corpo hoje?</p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { id: 'acima_do_peso', label: 'ACIMA DO PESO' },
                    { id: 'normal', label: 'NORMAL' },
                    { id: 'definido', label: 'DEFINIDO' },
                    { id: 'maromba', label: 'MAROMBA' }
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setFormData({ ...formData, bodySelfAssessment: item.id as BodySelfAssessment })}
                      className={cn(
                        "w-full p-5 rounded-2xl border-2 transition-all flex justify-between items-center",
                        formData.bodySelfAssessment === item.id ? "bg-primary/10 border-primary text-primary" : "bg-surface-container-low border-outline-variant/10 text-on-surface-variant"
                      )}
                    >
                      <span className="font-headline italic font-black text-lg uppercase">{item.label}</span>
                      {formData.bodySelfAssessment === item.id && <Check size={20} />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {currentStepId === 'gym' && (
              <div className="space-y-6">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                  <MapPin size={32} />
                </div>
                <div className="space-y-2">
                  <h2 className="font-headline italic font-black text-4xl uppercase tracking-tighter">SUA ARENA</h2>
                  <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest">Em qual academia você treina?</p>
                  <p className="text-[9px] font-bold text-primary/80 uppercase">Isso define o seu ranking local e seus incentivos de performance.</p>
                </div>
                
                <div className="space-y-3 max-h-[350px] overflow-y-auto no-scrollbar pb-4">
                  {gymLoading ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-3 opacity-40">
                      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="font-label text-[10px] font-black uppercase tracking-widest">Localizando academias...</span>
                    </div>
                  ) : gymError ? (
                    <div className="p-4 bg-error/10 border border-error/20 rounded-xl text-center space-y-3">
                      <p className="text-error font-label text-[10px] font-black uppercase">{gymError}</p>
                      <button 
                         onClick={loadNearbyGyms}
                         className="text-primary font-label text-[10px] font-black uppercase border border-primary/20 px-4 py-2 rounded-lg"
                      >
                         TENTAR NOVAMENTE
                      </button>
                    </div>
                  ) : nearbyGyms.length > 0 ? (
                    nearbyGyms.map((gym) => {
                      const gymLat = gym.geometry?.location?.lat !== undefined 
                        ? (typeof gym.geometry.location.lat === 'function' ? gym.geometry.location.lat() : gym.geometry.location.lat) 
                        : (gym.lat || gym.latitude);
                      const gymLng = gym.geometry?.location?.lng !== undefined 
                        ? (typeof gym.geometry.location.lng === 'function' ? gym.geometry.location.lng() : gym.geometry.location.lng) 
                        : (gym.lng || gym.longitude);

                      return (
                        <button
                          key={gym.place_id || gym.id}
                          onClick={() => setFormData({ 
                            ...formData, 
                            gymId: gym.place_id || gym.id, 
                            gymName: gym.name,
                            gymLocation: (gymLat !== undefined && gymLng !== undefined) ? { lat: Number(gymLat), lng: Number(gymLng) } : null
                          })}
                          className={cn(
                            "w-full p-6 rounded-2xl border-2 transition-all flex flex-col items-start gap-1 text-left",
                            formData.gymId === (gym.place_id || gym.id) ? "bg-primary/10 border-primary shadow-lg shadow-primary/5" : "bg-surface-container-low border-outline-variant/10"
                          )}
                        >
                          <div className="flex justify-between items-center w-full">
                            <span className={cn(
                              "font-headline italic font-black text-xl uppercase tracking-tight",
                              formData.gymId === (gym.place_id || gym.id) ? "text-primary" : "text-on-surface"
                            )}>
                              {gym.name}
                            </span>
                            {formData.gymId === (gym.place_id || gym.id) && <Check size={20} className="text-primary" />}
                          </div>
                          <span className="font-label text-[9px] font-bold text-on-surface-variant uppercase tracking-widest leading-none">
                            {gym.vicinity || gym.address}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 opacity-40">
                       <p className="font-label text-[10px] font-black uppercase">Nenhuma academia encontrada próxima.</p>
                    </div>
                  )}

                  <button 
                    onClick={() => {
                        const name = prompt('Digite o nome da sua academia:');
                        if (name) {
                            alert('Atenção: Para poder realizar check-ins e validar treinos na academia, certifique-se de selecionar sua academia oficial no mapa no menu "Academia".');
                            setFormData({ 
                              ...formData, 
                              gymId: `manual_${Date.now()}`, 
                              gymName: name,
                              gymLocation: null
                            });
                        }
                    }}
                    className="w-full p-4 border-2 border-dashed border-outline-variant/30 rounded-2xl text-on-surface-variant/40 hover:text-primary hover:border-primary/40 transition-all flex items-center justify-center gap-2"
                  >
                    <span className="font-label text-[10px] font-black uppercase tracking-widest">MINHA ACADEMIA NÃO ESTÁ AQUI</span>
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer Navigation */}
      <footer className="p-6 bg-surface-container-low border-t border-outline-variant/10">
        <div className="max-w-md mx-auto flex gap-4">
          {currentStepIndex > 0 && (
            <button
              onClick={handleBack}
              className="w-20 h-16 bg-surface-container-highest text-on-surface rounded-2xl flex items-center justify-center active:scale-95 transition-all"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <button
            onClick={handleNext}
            disabled={loading}
            className="flex-grow h-16 bg-primary text-on-primary rounded-2xl font-headline italic font-black text-xl uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? "SALVANDO..." : currentStepIndex === totalSteps - 1 ? "FINALIZAR" : "PRÓXIMO"}
            {!loading && <ChevronRight size={24} />}
          </button>
        </div>
      </footer>
    </div>
  );
}
