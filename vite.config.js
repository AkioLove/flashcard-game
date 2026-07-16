import { defineConfig } from 'vite';

export default defineConfig({
  base: '/flashcard-game/',
  worker: {
    format: 'es',
  },
});
