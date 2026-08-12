import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bell, X, Trophy, CreditCard, ShieldAlert, CheckCircle, ArrowRight } from 'lucide-react';
import { UserProfile } from '../types';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: UserProfile['notifications'];
  onMarkAsRead: (id: string) => void;
  onClearAll: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ 
  isOpen, 
  onClose, 
  notifications = [], 
  onMarkAsRead,
  onClearAll
}) => {
  const unreadCount = notifications.filter(n => !n.read).length;

  const getIcon = (type: string) => {
    switch (type) {
      case 'ranking': return <Trophy className="text-prize-gold" size={20} />;
      case 'payment': return <CreditCard className="text-primary" size={20} />;
      case 'achievement': return <CheckCircle className="text-secondary" size={20} />;
      default: return <ShieldAlert className="text-on-surface-variant" size={20} />;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-surface z-[70] shadow-2xl flex flex-col"
          >
            <div className="p-6 border-b border-outline-variant/10 flex items-center justify-between bg-surface-container-low">
              <div className="flex flex-col">
                <span className="font-headline italic font-black text-2xl text-on-surface">NOTIFICAÇÕES</span>
                <span className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
                  {unreadCount > 0 ? `${unreadCount} NOVAS MENSAGENS` : 'TUDO EM DIA'}
                </span>
              </div>
              <button 
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface active:scale-95 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
              {notifications.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mb-4">
                    <Bell className="text-on-surface-variant/30" size={32} />
                  </div>
                  <span className="font-headline italic font-black text-xl text-on-surface-variant/40">NADA POR AQUI</span>
                  <p className="text-xs font-bold text-on-surface-variant/60 uppercase tracking-tight mt-2">
                    Te avisaremos quando você for ultrapassado ou receber novos incentivos!
                  </p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <motion.div
                    key={notif.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={cn(
                      "p-4 rounded-2xl border transition-all relative group overflow-hidden",
                      notif.read 
                        ? "bg-surface-container-low border-outline-variant/10" 
                        : "bg-surface-container-high border-primary/30 shadow-lg"
                    )}
                    onClick={() => onMarkAsRead(notif.id)}
                  >
                    {!notif.read && (
                      <div className="absolute top-0 right-0 w-2 h-full bg-primary" />
                    )}
                    <div className="flex gap-4">
                      <div className="w-12 h-12 rounded-xl bg-surface-container-highest flex items-center justify-center shrink-0">
                        {getIcon(notif.type)}
                      </div>
                      <div className="flex-1 flex flex-col gap-1">
                        <div className="flex justify-between items-start">
                          <span className="font-label text-[10px] font-black text-on-surface uppercase tracking-widest">{notif.title}</span>
                          <span className="font-label text-[8px] font-bold text-on-surface-variant/60 uppercase">
                            {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true, locale: ptBR })}
                          </span>
                        </div>
                        <p className={cn(
                          "text-xs font-bold leading-tight",
                          notif.read ? "text-on-surface-variant" : "text-on-surface"
                        )}>
                          {notif.message}
                        </p>
                        
                        {notif.actionUrl && (
                          <button className="mt-2 flex items-center gap-1 text-primary group-hover:gap-2 transition-all">
                            <span className="font-label text-[9px] font-black uppercase tracking-widest">VER DETALHES</span>
                            <ArrowRight size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>

            {notifications.length > 0 && (
              <div className="p-6 bg-surface-container-low border-t border-outline-variant/10">
                <button 
                  onClick={onClearAll}
                  className="w-full h-12 border border-outline-variant/30 rounded-xl font-label text-[10px] font-black text-on-surface-variant uppercase tracking-widest active:scale-95 transition-all hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/50"
                >
                  LIMPAR TODAS
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
