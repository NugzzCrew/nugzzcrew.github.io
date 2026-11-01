# Nugzz Crew Auth Update

## What changed
- Removed auth-astro / server adapter (site stays pure static on GitHub Pages)
- Added client-side YouTube (Google) sign-in
- Added Discord account linking via PKCE (no client secret in browser)
- Sign In button in header opens a modal
- User data stored in localStorage

## Setup steps

1. Replace these files in your project:
   - `astro.config.mjs`
   - `src/layouts/MainLayout.astro`
   - `public/js/auth.js`

2. Edit `public/js/auth.js` and replace the placeholders:
   - `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com`
   - `YOUR_DISCORD_CLIENT_ID`

3. Google Cloud Console:
   - Authorized JavaScript origins:
     - `https://officialnugzzcrew.com`
     - `https://nugzzcrew.github.io`
     - `http://localhost:4321`

4. Discord Developer Portal:
   - Add redirect URI: `https://officialnugzzcrew.com/`
   - Also add `http://localhost:4321/` for local testing

5. Optional cleanup:
   ```
   npm uninstall auth-astro @auth/core @astrojs/node
   ```
   Delete `auth.config.ts` and `.env` if you no longer need them.

6. Commit and push. The Sign In button will work on the live GitHub Pages site.

## How it works
- User clicks Sign In → YouTube login
- After YouTube success, they can click "Link Discord"
- Both accounts are stored locally for stream chat and DMO tickets
