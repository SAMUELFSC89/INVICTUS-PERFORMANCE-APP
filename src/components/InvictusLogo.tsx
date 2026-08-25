import React from 'react';

interface InvictusLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
}

export function InvictusLogo({ size = 120, className = '', showText = false }: InvictusLogoProps) {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <img
        src="/capacete.webp"
        alt="Emblema Invictus"
        width={size}
        height={size}
        draggable={false}
        className="select-none object-contain"
        style={{ width: size, height: size }}
        onError={(e) => {
          const target = e.currentTarget;
          if (!target.src.endsWith('/capacete.png')) {
            target.src = '/capacete.png';
          }
        }}
      />
      
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
