import { fileURLToPath } from 'node:url';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

// The desktop preview's WebXR emulator: IWSDK's prebuilt runtime (IWER and its virtual rooms), the
// one its dev server injects. The plugin doesn't export it, so it is aliased by path. The page
// imports it on demand, only on computers that can't start mixed reality, so headsets never load it.
const emulatorRuntime = fileURLToPath(new URL('./node_modules/@iwsdk/vite-plugin-dev/dist/injection/runtime.js', import.meta.url));

export default defineConfig({
  plugins: [iwsdkDev()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  resolve: {
    alias: { 'iwsdk-emulator-runtime': emulatorRuntime },
    dedupe: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide'],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
