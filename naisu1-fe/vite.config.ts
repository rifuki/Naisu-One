import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 8080,
        host: '0.0.0.0',
        proxy: {
          '/api/openclaw': {
            target: 'https://ai.naisu.one',
            changeOrigin: true,
            secure: true,
            rewrite: (path) => path.replace(/^\/api\/openclaw/, ''),
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.OPENCLAW_API_URL': JSON.stringify(env.OPENCLAW_API_URL || 'https://ai.naisu.one/v1/chat/completions'),
        'process.env.OPENCLAW_API_KEY': JSON.stringify(env.OPENCLAW_API_KEY || ''),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
