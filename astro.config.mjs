// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import auth from 'auth-astro';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://officialnugzzcrew.com',
  base: '/',
  output: 'static',
  build: {
    format: 'file',
  },
  adapter: node({
    mode: 'standalone',
  }),
  vite: {
    plugins: [tailwindcss()]
  },
  integrations: [auth()]
});