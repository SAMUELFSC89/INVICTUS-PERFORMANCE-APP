import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    // Os projetos nativos são gerados pelo Capacitor/Xcode/Gradle e não são
    // código-fonte JavaScript sujeito a estas regras. Mantê-los fora do lint
    // evita falsos positivos (inclusive arquivos compilados em android/).
    ignores: [
      'dist/**/*',
      'server-dist/**/*',
      'coverage/**/*',
      'android/**/*',
      'ios/**/*',
      'node_modules/**/*',
    ]
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
