// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import auth from 'auth-astro';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  // Tell Astro your official URL
  site: 'https://officialnugzzcrew.com',

  base: '/',

  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [auth()]
});