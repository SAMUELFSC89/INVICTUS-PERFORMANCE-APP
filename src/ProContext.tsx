import React, { createContext, useContext, useState } from 'react';
import { ProModal } from './components/ProModal';

interface ProContextType {
  showProInvitation: (reason?: string) => void;
}

const ProContext = createContext<ProContextType | undefined>(undefined);

export function ProProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);

  const showProInvitation = (msg?: string) => {
    setReason(msg);
    setIsOpen(true);
  };

  return (
    <ProContext.Provider value={{ showProInvitation }}>
      {children}
      <ProModal 
        isOpen={isOpen} 
        onClose={() => setIsOpen(false)} 
        reason={reason} 
      />
    </ProContext.Provider>
  );
}

export function usePro() {
  const context = useContext(ProContext);
  if (context === undefined) {
    throw new Error('usePro must be used within a ProProvider');
  }
  return context;
}
