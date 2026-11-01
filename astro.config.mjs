// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import auth from 'auth-astro';

// https://astro.build/config
export default defineConfig({
  // Tell Astro your official URL
  site: 'https://officialnugzzcrew.com',

  base: '/',

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [auth()]
});