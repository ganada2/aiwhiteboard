import tailwindcss from '@tailwindcss/vite';
import aitDevtools from '@apps-in-toss/devtools/unplugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { aiWhiteboardApiPlugin } from './src/server/apiPlugin';

export default defineConfig({
  plugins: [aitDevtools.vite(), tailwindcss(), react(), aiWhiteboardApiPlugin()],
});
