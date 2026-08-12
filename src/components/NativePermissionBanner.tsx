import React, { useState, useEffect } from 'react';
import { ShieldCheck, MapPin, Activity, Bell, HeartPulse, Check, ChevronRight, X, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { checkAllNativePermissions, requestAllNativePermissions, PermissionStatusSummary } from '../lib/nativePermissions';

interface Props {
  forceShow?: boolean;
  onClose?: () => void;
}

export const NativePermissionBanner: React.FC<Props> = ({ forceShow = false, onClose }) => {
  const [summary, setSummary] = useState<PermissionStatusSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkAllNativePermissions().then((res) => {
      setSummary(res);
      // Auto-dismiss if all permissions are granted or if dismissed previously in session
      if (res.allGranted && !forceShow) {
        setDismissed(true);
      }
    });
  }, [forceShow]);

  const handleGrant = async () => {
    setLoading(true);
    try {
      const res = await requestAllNativePermissions();
      setSummary(res);
      if (res.allGranted) {
        setTimeout(() => {
          setDismissed(true);
          if (onClose) onClose();
        }, 1200);
      }
    } catch (err) {
      console.error('[NativePermissionBanner] Error requesting permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!Capacitor.isNativePlatform() && !forceShow) {
    return null;
  }

  if (dismissed && !forceShow) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-20 left-4 right-4 z-50 max-w-md mx-auto bg-neutral-900/95 backdrop-blur-xl border border-amber-500/30 rounded-2xl p-4 shadow-2xl text-white overflow-hidden"
      >
        {/* Glow accent */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black tracking-tight text-white uppercase flex items-center gap-1.5">
                Permissões do APK Invictus
                <Sparkles size={13} className="text-amber-400" />
              </h3>
              <p className="text-[11px] text-neutral-400 leading-tight">
                Autorize o aplicativo para liberar GPS, Smartwatch e saúde.
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              setDismissed(true);
              if (onClose) onClose();
            }}
            className="text-neutral-500 hover:text-neutral-300 p-1 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Permissions breakdown */}
        <div className="space-y-2 mb-4 bg-black/40 rounded-xl p-2.5 border border-white/5 text-xs">
          {/* Location */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <MapPin size={15} className="text-amber-400 shrink-0" />
              <div>
                <span className="font-semibold text-neutral-200 block">GPS & Geolocalização</span>
                <span className="text-[10px] text-neutral-400">Check-in de academias e rotas de corrida</span>
              </div>
            </div>
            {summary?.location === 'granted' ? (
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Check size={10} /> Ativo
              </span>
            ) : (
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                Pendente
              </span>
            )}
          </div>

          {/* Health Connect */}
          <div className="flex items-center justify-between py-1 border-t border-white/5">
            <div className="flex items-center gap-2">
              <HeartPulse size={15} className="text-rose-400 shrink-0" />
              <div>
                <span className="font-semibold text-neutral-200 block">Saúde & Smartwatch</span>
                <span className="text-[10px] text-neutral-400">Batimentos, calorias e Health Connect</span>
              </div>
            </div>
            {summary?.healthConnect === 'granted' ? (
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Check size={10} /> Ativo
              </span>
            ) : (
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                Pendente
              </span>
            )}
          </div>

          {/* Activity Recognition */}
          <div className="flex items-center justify-between py-1 border-t border-white/5">
            <div className="flex items-center gap-2">
              <Activity size={15} className="text-cyan-400 shrink-0" />
              <div>
                <span className="font-semibold text-neutral-200 block">Sensores de Movimento</span>
                <span className="text-[10px] text-neutral-400">Contagem de passos e cadência</span>
              </div>
            </div>
            {summary?.location === 'granted' ? (
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Check size={10} /> Ativo
              </span>
            ) : (
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                Pendente
              </span>
            )}
          </div>

          {/* Notifications */}
          <div className="flex items-center justify-between py-1 border-t border-white/5">
            <div className="flex items-center gap-2">
              <Bell size={15} className="text-purple-400 shrink-0" />
              <div>
                <span className="font-semibold text-neutral-200 block">Notificações em Tempo Real</span>
                <span className="text-[10px] text-neutral-400">Avisos de treinos, desafios e conquistas</span>
              </div>
            </div>
            {summary?.notifications === 'granted' ? (
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Check size={10} /> Ativo
              </span>
            ) : (
              <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full">
                Opcional
              </span>
            )}
          </div>
        </div>

        {/* Primary CTA */}
        <button
          onClick={handleGrant}
          disabled={loading}
          className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-amber-500/20 disabled:opacity-50"
        >
          {loading ? (
            <span>Solicitando Permissões do Android...</span>
          ) : (
            <>
              <span>Conceder Permissões no APK</span>
              <ChevronRight size={14} />
            </>
          )}
        </button>
      </motion.div>
    </AnimatePresence>
  );
};
