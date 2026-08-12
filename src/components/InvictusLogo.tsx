import React from 'react';

interface InvictusLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
}

export function InvictusLogo({ size = 120, className = '', showText = false }: InvictusLogoProps) {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 512 512" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className="drop-shadow-[0_6px_20px_rgba(217,119,6,0.25)] select-none"
      >
        <defs>
          <linearGradient id="invictus-gold-react" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFEFA6" />
            <stop offset="15%" stopColor="#F5AB12" />
            <stop offset="50%" stopColor="#D97706" />
            <stop offset="85%" stopColor="#B45309" />
            <stop offset="100%" stopColor="#7C2D12" />
          </linearGradient>
        </defs>

        <g id="helmet-half-react">
          <path 
            d="M250,110 
               L210,160 
               L222,190 
               L210,165 
               L170,210 
               L170,300 
               L192,300 
               L192,345 
               L170,345 
               L170,390 
               L216,482 
               L250,422 Z
               
               M184,264 
               L234,264 
               L224,304 
               L184,304 Z" 
            fill="url(#invictus-gold-react)" 
            fillRule="evenodd"
          />
        </g>
        
        <use href="#helmet-half-react" transform="translate(512, 0) scale(-1, 1)" />
      </svg>
      
      {showText && (
        <div className="mt-4 flex flex-col items-center text-center select-none">
          <h1 className="font-headline italic font-black text-3xl md:text-4xl tracking-[0.25em] uppercase leading-none text-[#F1EADA] text-shadow-glow">
            INVICTUS
          </h1>
          {/* Glowing Golden Horizontal Axis bar from the design representation */}
          <div className="w-56 h-[1.5px] mt-3 bg-gradient-to-r from-transparent via-[#F5AB12]/90 to-transparent relative">
            <div className="absolute inset-0 bg-[#F5AB12] blur-[1px] opacity-70"></div>
          </div>
        </div>
      )}
    </div>
  );
}
