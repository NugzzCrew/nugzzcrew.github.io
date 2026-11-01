// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import auth from 'auth-astro';
import node from '@astrojs/node';

const isDev = process.env.NODE_ENV === 'development';

export default defineConfig({
  site: 'https://officialnugzzcrew.com',
  base: '/',
  output: isDev ? 'server' : 'static',
  adapter: isDev ? node({ mode: 'standalone' }) : undefined,
  vite: {
    plugins: [tailwindcss()]
  },
  integrations: [auth()]
});