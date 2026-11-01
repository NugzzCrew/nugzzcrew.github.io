// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import auth from 'auth-astro';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://officialnugzzcrew.com',
  base: '/',
  // Only use server output + adapter when running locally
  ...(process.env.NODE_ENV === 'development' && {
    output: 'server',
    adapter: node({ mode: 'standalone' }),
  }),
  vite: {
    plugins: [tailwindcss()]
  },
  integrations: [auth()]
});