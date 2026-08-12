import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Dumbbell, Zap, Utensils, Trophy, X, Compass, Clock, ShieldCheck, Check } from 'lucide-react';
import { userService } from '../services/userService';
import { UserProfile } from '../types';

interface ActivityInfoPopupProps {
  type: 'workout' | 'cardio' | 'running';
  isOpen: boolean;
  onClose: () => void;
}

export function ActivityInfoPopup({ type, isOpen, onClose }: ActivityInfoPopupProps) {
  const handleClose = async () => {
    const fieldMap = {
      workout: 'seenTreinoInfo',
      cardio: 'seenCardioInfo',
      running: 'seenCorridaInfo'
    } as const;

    try {
      await userService.updateProfile({ [fieldMap[type]]: true });
      onClose();
    } catch (error) {
      console.error('Error saving seen info:', error);
      onClose();
    }
  };

  const content = {
    workout: {
      title: 'TREINO (MUSCULAÇÃO)',
      icon: <Dumbbell className="text-primary" size={32} />,
      color: 'primary',
      description: 'Valide seu esforço na academia e acumule pontos de consistência.',
      bullets: [
        { icon: <Clock size={16} />, text: 'Pontuação baseada no tempo real e consistência de treino.' },
        { icon: <ShieldCheck size={16} />, text: 'Para segurança da competição, de forma automatizada e justa, validamos sua presença presencial e atividade.' },
        { icon: <Zap size={16} />, text: 'O treino presencial deve ser iniciado na sua unidade oficial cadastrada.' }
      ]
    },
    cardio: {
      title: 'CARDIO AO AR LIVRE',
      icon: <Compass className="text-alert-orange" size={32} />,
      color: 'alert-orange',
      description: 'Caminhadas, corridas ou pedaladas monitoradas.',
      bullets: [
        { icon: <Compass size={16} />, text: 'O monitoramento é feito estritamente via confirmação de trajeto ativo.' },
        { icon: <ShieldCheck size={16} />, text: 'Validamos o ritmo biológico real do atleta de forma automatizada e segura.' },
        { icon: <Clock size={16} />, text: 'Evite pausas excessivas ou desvios inesperados durante o seu percurso.' }
      ]
    },
    diet: {
      title: 'SEGUIR DIETA',
      icon: <Utensils className="text-blue-500" size={32} />,
      color: 'blue-500',
      description: 'Mantenha sua alimentação sob controle.',
      bullets: [
        { icon: <ShieldCheck size={16} />, text: 'Registre suas fotos de refeição em tempo real.' },
        { icon: <Clock size={16} />, text: 'A pontuação depende da janela de horário correta.' },
        { icon: <Zap size={16} />, text: 'Completar o dia 100% gera bônus extra.' }
      ]
    },
    running: {
      title: 'REGRAS DA CORRIDA',
      icon: <Trophy className="text-amber-500" size={32} />,
      color: 'amber-500',
      description: 'Competição mensal de quilometragem acumulada.',
      bullets: [
        { icon: <Compass size={16} />, text: 'Ranking baseado na distância validada por GPS.' },
        { icon: <Clock size={16} />, text: 'Ciclo de 30 dias para acumular KM.' },
        { icon: <ShieldCheck size={16} />, text: 'Fraudes (veículos) resultam em desclassificação.' }
      ]
    }
  }[type];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 md:p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-md bg-surface-container rounded-t-[40px] md:rounded-[40px] p-8 space-y-8 overflow-hidden shadow-2xl border border-outline-variant/10"
          >
            <div className="flex items-center gap-6">
              <div className={`w-16 h-16 bg-${content.color}/10 rounded-[24px] flex items-center justify-center`}>
                {content.icon}
              </div>
              <div className="flex-1">
                <h3 className="font-headline italic font-black text-2xl uppercase tracking-tighter text-on-surface line-clamp-1">{content.title}</h3>
                <p className="font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest">Guia de Atividade</p>
              </div>
              <button 
                onClick={handleClose}
                className="p-2 hover:bg-surface-container-high rounded-full transition-colors"
              >
                <X size={20} className="text-on-surface-variant" />
              </button>
            </div>

            <div className="space-y-6">
              <p className="text-on-surface-variant font-label text-sm font-medium leading-relaxed italic border-l-4 border-primary/20 pl-4 py-1">
                "{content.description}"
              </p>

              <div className="space-y-4">
                {content.bullets.map((b, i) => (
                  <div key={i} className="flex items-start gap-4 p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10">
                    <div className="p-2 bg-on-surface/5 text-on-surface rounded-xl shrink-0">
                      {b.icon}
                    </div>
                    <span className="font-label text-[11px] font-bold text-on-surface leading-tight uppercase tracking-tight">{b.text}</span>
                  </div>
                ))}
              </div>

              <button 
                onClick={handleClose}
                className="w-full h-16 bg-primary text-on-primary rounded-2xl font-headline italic font-black text-lg uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
              >
                <Check size={20} />
                ENTENDI E CONTINUAR
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
