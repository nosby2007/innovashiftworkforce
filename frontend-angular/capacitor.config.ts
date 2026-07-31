import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.innovashift.workforce',
  appName: 'InnovaShift Workforce',
  webDir: 'dist/innovacare-shift-frontend/browser',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#07533f',
      showSpinner: false
    }
  }
};

export default config;
