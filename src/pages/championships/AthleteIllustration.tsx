import React from 'react';

interface AthleteIllustrationProps {
  type: 'arena' | 'run_elite';
  className?: string;
}

export const AthleteIllustration: React.FC<AthleteIllustrationProps> = ({ type, className = '' }) => {
  if (type === 'arena') {
    return (
      <div className={`relative overflow-hidden flex items-center justify-center ${className}`}>
        {/* Warm Golden Glow Backdrop */}
        <div className="absolute inset-0 bg-gradient-to-tr from-amber-600/30 via-yellow-500/20 to-transparent blur-md pointer-events-none rounded-full" />
        
        {/* Dynamic Stylized Silhouette of Bodybuilder Lifting Dumbbell */}
        <svg
          viewBox="0 0 160 160"
          className="w-full h-full object-contain relative z-10 filter drop-shadow-[0_4px_12px_rgba(245,158,11,0.5)]"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFF1B8" />
              <stop offset="35%" stopColor="#F59E0B" />
              <stop offset="80%" stopColor="#D97706" />
              <stop offset="100%" stopColor="#78350F" />
            </linearGradient>
            <linearGradient id="barbellGold" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FDE68A" />
              <stop offset="50%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#B45309" />
            </linearGradient>
            <filter id="glowGold" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background circular aura */}
          <circle cx="85" cy="80" r="58" fill="url(#goldGrad)" fillOpacity="0.18" filter="url(#glowGold)" />
          <circle cx="85" cy="80" r="52" stroke="url(#goldGrad)" strokeWidth="1.5" strokeDasharray="3 3" strokeOpacity="0.4" />

          {/* Muscular Torso & Arm */}
          <path
            d="M50 145 C55 125 65 110 75 102 C82 96 90 94 98 88 C106 82 110 72 108 62 C106 52 98 46 88 44 C78 42 70 48 66 58 C62 68 58 80 50 92 C42 104 36 122 35 145 Z"
            fill="url(#goldGrad)"
          />
          {/* Head & Neck */}
          <circle cx="92" cy="42" r="14" fill="url(#goldGrad)" />
          {/* Biceps & Forearm Holding Dumbbell */}
          <path
            d="M85 88 C95 82 105 76 114 84 C122 92 128 106 124 116 C120 126 108 126 100 118 C92 110 86 98 85 88 Z"
            fill="url(#goldGrad)"
          />
          {/* Massive Dumbbell */}
          <rect x="110" y="80" width="8" height="42" rx="2" fill="url(#barbellGold)" stroke="#451A03" strokeWidth="1" transform="rotate(-25 114 101)" />
          <rect x="100" y="76" width="28" height="10" rx="3" fill="url(#barbellGold)" stroke="#451A03" strokeWidth="1" transform="rotate(-25 114 81)" />
          <rect x="100" y="112" width="28" height="10" rx="3" fill="url(#barbellGold)" stroke="#451A03" strokeWidth="1" transform="rotate(-25 114 117)" />

          {/* Muscle fiber highlights */}
          <path d="M72 82 Q85 75 95 85" stroke="#FEF3C7" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
          <path d="M96 94 Q108 92 114 104" stroke="#FEF3C7" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.9" />
          <path d="M60 115 Q74 108 82 125" stroke="#FDE68A" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.7" />
        </svg>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden flex items-center justify-center ${className}`}>
      {/* Cyan/Teal Glow Backdrop */}
      <div className="absolute inset-0 bg-gradient-to-tr from-teal-600/35 via-cyan-500/25 to-transparent blur-md pointer-events-none rounded-full" />
      
      {/* Dynamic Stylized Silhouette of Elite Runner */}
      <svg
        viewBox="0 0 160 160"
        className="w-full h-full object-contain relative z-10 filter drop-shadow-[0_4px_12px_rgba(20,184,166,0.5)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="tealGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#CCFBF1" />
            <stop offset="35%" stopColor="#14B8A6" />
            <stop offset="80%" stopColor="#0F766E" />
            <stop offset="100%" stopColor="#042F2E" />
          </linearGradient>
          <filter id="glowTeal" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Background circular pulse & speed lines */}
        <circle cx="85" cy="80" r="58" fill="url(#tealGrad)" fillOpacity="0.18" filter="url(#glowTeal)" />
        <circle cx="85" cy="80" r="52" stroke="url(#tealGrad)" strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity="0.4" />
        <line x1="25" y1="65" x2="60" y2="65" stroke="#2DD4BF" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.6" />
        <line x1="18" y1="85" x2="52" y2="85" stroke="#2DD4BF" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.8" />
        <line x1="28" y1="105" x2="58" y2="105" stroke="#2DD4BF" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5" />

        {/* Runner Head & Torso with Forward Motion */}
        <circle cx="102" cy="40" r="13" fill="url(#tealGrad)" />
        <path
          d="M92 48 C98 55 106 65 100 80 C94 95 86 102 78 110 L68 138"
          stroke="url(#tealGrad)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Forward Leg */}
        <path
          d="M86 100 L110 115 L125 142"
          stroke="url(#tealGrad)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Backward Leg */}
        <path
          d="M78 106 L52 118 L32 112"
          stroke="url(#tealGrad)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Arms Pumping */}
        <path
          d="M94 65 L120 74 L132 62"
          stroke="url(#tealGrad)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M90 68 L70 78 L60 96"
          stroke="url(#tealGrad)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Speed trail highlights */}
        <path d="M96 52 Q108 62 104 76" stroke="#F0FDFA" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.9" />
        <path d="M88 102 Q106 112 120 138" stroke="#CCFBF1" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
      </svg>
    </div>
  );
};
