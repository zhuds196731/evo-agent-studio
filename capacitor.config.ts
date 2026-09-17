import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 手持设备外壳：复用同一份 dist 产物打包 Android / iOS。
 * 首次使用执行：npm run mobile:init
 */
const config: CapacitorConfig = {
  appId: 'com.evo.agentstudio',
  appName: 'Self-Evolving Agent',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  plugins: {
    SplashScreen: { launchAutoHide: true, backgroundColor: '#070a12' },
  },
};

export default config;
