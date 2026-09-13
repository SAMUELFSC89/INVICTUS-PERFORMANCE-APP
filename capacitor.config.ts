import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.desafiosemdesculpa.app',
  appName: 'INVICTUS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      'invictusperformance.app.br', 
      'www.invictusperformance.app.br', 
      '*.google.com', 
      '*.googleapis.com', 
      '*.firebaseapp.com', 
      'accounts.google.com'
    ]
  },
  ios: {
    // #232: 'never' em vez de 'automatic'.
    //
    // Com 'automatic' o WebView aplica os insets sozinho. Somado ao
    // apple-mobile-web-app-status-bar-style: black-translucent do index.html,
    // dava inset duplicado: sobrava um espaco morto no rodape e o cabecalho
    // ainda assim ficava por baixo do relogio e da bateria.
    //
    // Agora o WebView ocupa a tela inteira e QUEM controla as areas seguras e o
    // CSS, via env(safe-area-inset-*) em #main-header e #bottom-nav.
    contentInset: 'never',
    scrollEnabled: true,
    allowsLinkPreview: false,
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#000000",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: true,
      androidSpinnerStyle: "large",
      spinnerColor: "#00E676",
      splashFullScreen: true,
      splashImmersive: true,
    },
    PushNotifications: {
      // Capacitor 8 marca `alert` como legado no iOS; `banner` + `list`
      // preservam a apresentação moderna em foreground e continuam mapeando
      // para o comportamento de alerta no Android.
      presentationOptions: ["badge", "sound", "banner", "list"],
    },
  },
};

export default config;