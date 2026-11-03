// Nugzz Crew client-side auth (YouTube + Discord link)
let googleTokenClient;
let currentUser = null;

const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
const DISCORD_CLIENT_ID = "YOUR_DISCORD_CLIENT_ID";
const DISCORD_REDIRECT = "https://officialnugzzcrew.com/";

function setupGoogle() {
  if (typeof google !== "undefined" && google.accounts?.oauth2) {
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/youtube.readonly",
      callback: async (response) => {
        if (response?.access_token) {
          await fetchYouTubeProfile(response.access_token);
        }
      },
    });
  } else {
    setTimeout(setupGoogle, 100);
  }
}

async function fetchYouTubeProfile(accessToken) {
  const res = await fetch(
    "https://youtube.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (data.items?.[0]) {
    const ch = data.items[0];
    const user = {
      youtubeId: ch.id,
      name: ch.snippet.title,
      picture: ch.snippet.thumbnails?.default?.url || "",
      discord: null,
    };
    saveUser(user);
    updateAuthUI();
  }
}

function saveUser(user) {
  currentUser = user;
  localStorage.setItem("nugzzUser", JSON.stringify(user));
}

function loadUser() {
  const raw = localStorage.getItem("nugzzUser");
  if (raw) currentUser = JSON.parse(raw);
  updateAuthUI();
}

function updateAuthUI() {
  const btn = document.getElementById("auth-btn");
  if (!btn) return;

  if (currentUser) {
    btn.innerHTML = currentUser.picture
      ? `<img src="${currentUser.picture}" class="w-7 h-7 sm:w-6 sm:h-6 rounded-full object-cover" alt="" /> <span class="hidden sm:inline">${currentUser.name}</span>`
      : `<span class="hidden sm:inline">${currentUser.name}</span><span class="sm:hidden text-xs uppercase tracking-wide">Me</span>`;
  } else {
    btn.innerHTML = `<span>Sign In</span>`;
  }

  const content = document.getElementById("auth-modal-content");
  if (!content) return;
  if (!currentUser) {
    content.innerHTML = `
      <p class="text-zinc-400 text-sm mb-4">Sign in with YouTube to chat and create DMO tickets.</p>
      <button id="yt-signin" class="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium">Sign in with YouTube</button>
    `;
    document.getElementById("yt-signin")?.addEventListener("click", () => {
      googleTokenClient?.requestAccessToken({ prompt: "consent" });
    });
  } else {
    const discordStatus = currentUser.discord
      ? `<p class="text-green-400 text-sm">Discord linked: ${currentUser.discord.username}</p>`
      : `<button id="link-discord" class="w-full px-4 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg font-medium">Link Discord</button>`;
    content.innerHTML = `
      <div class="flex items-center gap-3 mb-4">
        ${currentUser.picture ? `<img src="${currentUser.picture}" class="w-10 h-10 rounded-full" alt="" />` : ""}
        <div>
          <p class="text-white font-medium">${currentUser.name}</p>
          <p class="text-zinc-400 text-sm">YouTube</p>
        </div>
      </div>
      ${discordStatus}
      <button id="signout" class="w-full mt-3 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 hover:border-gold text-sm uppercase tracking-widest">Sign Out</button>
    `;
    document.getElementById("link-discord")?.addEventListener("click", startDiscordLink);
    document.getElementById("signout")?.addEventListener("click", signOut);
  }
}

function signOut() {
  localStorage.removeItem("nugzzUser");
  currentUser = null;
  updateAuthUI();
  document.getElementById("auth-modal")?.classList.add("hidden");
  document.getElementById("auth-modal")?.classList.remove("flex");
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function startDiscordLink() {
  const verifier = generateCodeVerifier();
  sessionStorage.setItem("discord_verifier", verifier);
  const challenge = await generateCodeChallenge(verifier);
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT,
    response_type: "code",
    scope: "identify",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `https://discord.com/oauth2/authorize?${params}`;
}

async function handleDiscordCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return;
  const verifier = sessionStorage.getItem("discord_verifier");
  if (!verifier) return;

  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: DISCORD_REDIRECT,
    code_verifier: verifier,
  });

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return;

  const userRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const discordUser = await userRes.json();

  if (currentUser) {
    currentUser.discord = {
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar,
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + (tokenData.expires_in || 604800) * 1000,
    };
    saveUser(currentUser);
  }
  window.history.replaceState({}, document.title, window.location.pathname);
  updateAuthUI();
}

window.addEventListener("load", () => {
  setupGoogle();
  loadUser();
  handleDiscordCallback();
});

window.openAuthModal = function () {
  const modal = document.getElementById("auth-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  updateAuthUI();
};

window.closeAuthModal = function () {
  const modal = document.getElementById("auth-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
};
