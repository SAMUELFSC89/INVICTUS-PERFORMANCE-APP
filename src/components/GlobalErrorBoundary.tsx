import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#121212] flex flex-col items-center justify-center p-6 text-center text-white font-sans">
          <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <h1 className="italic font-black text-2xl uppercase mb-2">Algo deu errado</h1>
          <p className="opacity-60 text-xs max-w-xs uppercase tracking-widest mb-8">
            Ocorreu um erro inesperado. Por favor, tente recarregar a página.
          </p>
          {this.state.error && (
            <pre className="bg-white/5 p-4 rounded-xl text-[10px] text-red-400 font-mono overflow-auto max-w-full mb-8 text-left border border-white/10">
              {this.state.error.message}
            </pre>
          )}
          <button 
            onClick={() => window.location.reload()}
            className="bg-yellow-500 text-black px-8 py-4 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-yellow-400 transition-colors"
          >
            Recarregar Página
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
