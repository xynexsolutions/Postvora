const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(PUBLIC_DIR, "uploads"));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const DB_FILE = path.join(DATA_DIR, "db.json");
const APP_SECRET = process.env.APP_SECRET || "change-this-secret-before-production";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);
const SUPABASE_SNAPSHOT_KEY = "app_snapshot";
let dbCache = null;
let dbInitialized = false;
let dbInitPromise = null;
let dbWritePromise = Promise.resolve();
const LINKEDIN_TEST_ORGANIZATION = {
  id: "test-devtestco",
  type: "test",
  name: "DevTestCo test page",
  urn: "urn:li:organization:2414183"
};

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const providers = {
  facebook: {
    name: "Facebook",
    handle: "Pages",
    icon: "f",
    color: "#1877f2",
    logoSlug: "facebook",
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    clientIdEnv: "META_CLIENT_ID",
    clientSecretEnv: "META_CLIENT_SECRET",
    scopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
    supports: ["text", "image", "video", "link", "analytics"]
  },
  instagram: {
    name: "Instagram",
    handle: "Creator + Business",
    icon: "ig",
    color: "#e4405f",
    logoSlug: "instagram",
    authUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    clientIdEnv: "INSTAGRAM_CLIENT_ID",
    clientSecretEnv: "INSTAGRAM_CLIENT_SECRET",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    supports: ["image", "video", "reels", "analytics"]
  },
  linkedin: {
    name: "LinkedIn",
    handle: "Company + Member",
    icon: "in",
    color: "#0a66c2",
    logoSlug: "linkedin",
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    scopes: ["openid", "profile", "w_member_social", "r_organization_social", "w_organization_social"],
    supports: ["text", "image", "video", "article", "analytics"]
  },
  x: {
    name: "X",
    handle: "Twitter",
    icon: "x",
    color: "#111111",
    logoSlug: "x",
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    clientIdEnv: "X_CLIENT_ID",
    clientSecretEnv: "X_CLIENT_SECRET",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    supports: ["text", "image", "video", "threads"]
  },
  youtube: {
    name: "YouTube",
    handle: "Channel",
    icon: "yt",
    color: "#ff0000",
    logoSlug: "youtube",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    supports: ["video", "shorts", "analytics"]
  },
  tiktok: {
    name: "TikTok",
    handle: "Business",
    icon: "tk",
    color: "#111827",
    logoSlug: "tiktok",
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    clientIdEnv: "TIKTOK_CLIENT_ID",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    scopes: ["user.info.basic", "video.publish"],
    supports: ["video", "shorts"]
  },
  pinterest: {
    name: "Pinterest",
    handle: "Boards",
    icon: "p",
    color: "#bd081c",
    logoSlug: "pinterest",
    authUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    clientIdEnv: "PINTEREST_CLIENT_ID",
    clientSecretEnv: "PINTEREST_CLIENT_SECRET",
    scopes: ["pins:read", "pins:write", "boards:read"],
    supports: ["image", "link", "analytics"]
  },
  threads: {
    name: "Threads",
    handle: "Profile",
    icon: "th",
    color: "#000000",
    logoSlug: "threads",
    authUrl: "https://threads.net/oauth/authorize",
    tokenUrl: "https://graph.threads.net/oauth/access_token",
    clientIdEnv: "THREADS_CLIENT_ID",
    clientSecretEnv: "THREADS_CLIENT_SECRET",
    scopes: ["threads_basic", "threads_content_publish"],
    supports: ["text", "image", "video"]
  }
};

const defaultProfile = {
  id: "default",
  name: "Postvora Studio",
  owner: "Admin",
  plan: "Launch",
  timezone: "Asia/Karachi",
  apiKey: `pp_${crypto.randomBytes(18).toString("hex")}`,
  createdAt: new Date().toISOString()
};

function defaultDb() {
  return {
    profile: defaultProfile,
    users: {},
    sessions: {},
    authStates: {},
    emailVerifications: {},
    connections: {},
    oauthStates: {},
    posts: [],
    automations: [
      {
        id: crypto.randomUUID(),
        name: "Best-time scheduler",
        trigger: "When a post is saved as draft",
        action: "Suggest the highest engagement window",
        enabled: true
      },
      {
        id: crypto.randomUUID(),
        name: "UTM link builder",
        trigger: "When a URL is detected",
        action: "Append campaign tracking parameters",
        enabled: false
      }
    ],
    events: []
  };
}

function normalizeDb(db) {
  const fallback = defaultDb();
  const normalized = db && typeof db === "object" ? db : fallback;
  normalized.profile = normalized.profile || fallback.profile;
  normalized.connections = normalized.connections || {};
  normalized.users = normalized.users || {};
  normalized.sessions = normalized.sessions || {};
  normalized.authStates = normalized.authStates || {};
  normalized.emailVerifications = normalized.emailVerifications || {};
  normalized.oauthStates = normalized.oauthStates || {};
  normalized.posts = Array.isArray(normalized.posts) ? normalized.posts : [];
  normalized.automations = Array.isArray(normalized.automations) ? normalized.automations : fallback.automations;
  normalized.events = Array.isArray(normalized.events) ? normalized.events : [];
  return normalized;
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb(), null, 2));

  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  let changed = false;
  if (!db.profile) {
    db.profile = defaultProfile;
    changed = true;
  }
  if (!db.connections) {
    db.connections = {};
    changed = true;
  }
  if (!db.users) {
    db.users = {};
    changed = true;
  }
  if (!db.sessions) {
    db.sessions = {};
    changed = true;
  }
  if (!db.authStates) {
    db.authStates = {};
    changed = true;
  }
  if (!db.emailVerifications) {
    db.emailVerifications = {};
    changed = true;
  }
  if (!db.oauthStates) {
    db.oauthStates = {};
    changed = true;
  }
  const demoConnections = Object.entries(db.connections).filter(([, connection]) => connection.mode === "demo");
  if (demoConnections.length) {
    for (const [providerId] of demoConnections) delete db.connections[providerId];
    db.events = Array.isArray(db.events) ? db.events : [];
    db.events.unshift({
      id: crypto.randomUUID(),
      type: "migration",
      message: "Demo social links removed. Real OAuth login is now required.",
      details: {},
      createdAt: new Date().toISOString()
    });
    changed = true;
  }
  if (!Array.isArray(db.posts)) {
    db.posts = [];
    changed = true;
  }
  if (!Array.isArray(db.automations)) {
    db.automations = defaultDb().automations;
    changed = true;
  }
  if (!Array.isArray(db.events)) {
    db.events = [];
    changed = true;
  }
  if (changed) fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

async function supabaseRest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.error || text || "Supabase request failed";
    throw new Error(message);
  }
  return body;
}

async function loadSupabaseSnapshot() {
  const rows = await supabaseRest(`admin_settings?key=eq.${encodeURIComponent(SUPABASE_SNAPSHOT_KEY)}&select=value&limit=1`);
  return rows && rows[0] ? normalizeDb(rows[0].value) : null;
}

async function saveSupabaseSnapshot(db) {
  if (!USE_SUPABASE) return;
  await supabaseRest("admin_settings?on_conflict=key", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      key: SUPABASE_SNAPSHOT_KEY,
      value: db,
      updated_at: new Date().toISOString()
    })
  });
}

async function initializeDb() {
  if (dbInitialized) return dbCache;
  if (dbInitPromise) return dbInitPromise;
  dbInitPromise = (async () => {
    ensureDb();
    const localDb = normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
    dbCache = localDb;

    if (USE_SUPABASE) {
      try {
        const remoteDb = await loadSupabaseSnapshot();
        if (remoteDb) {
          dbCache = remoteDb;
          fs.writeFileSync(DB_FILE, JSON.stringify(dbCache, null, 2));
        } else {
          await saveSupabaseSnapshot(dbCache);
        }
      } catch (error) {
        console.error("Supabase snapshot unavailable; using local data:", error.message);
      }
    }

    dbInitialized = true;
    return dbCache;
  })();
  return dbInitPromise;
}

function readDb() {
  if (!dbCache) {
    ensureDb();
    dbCache = normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
  }
  return dbCache;
}

async function writeDb(db) {
  ensureDb();
  dbCache = normalizeDb(db);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  if (USE_SUPABASE) {
    dbWritePromise = dbWritePromise
      .catch(() => {})
      .then(() => saveSupabaseSnapshot(dbCache))
      .catch(error => {
        console.error("Supabase snapshot save failed:", error.message);
      });
    await dbWritePromise;
  }
}

function addEvent(db, type, message, details = {}) {
  db.events.unshift({
    id: crypto.randomUUID(),
    type,
    message,
    details,
    createdAt: new Date().toISOString()
  });
  db.events = db.events.slice(0, 80);
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

function redirect(res, target) {
  res.writeHead(302, { location: target });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 16_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function jsonBody(body) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "")
    .split(";")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const index = item.indexOf("=");
      return index === -1 ? [item, ""] : [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
    }));
}

function sessionCookie(sessionId, maxAge = 60 * 60 * 24 * 30) {
  const secure = APP_URL.startsWith("https://") ? "; Secure" : "";
  return `postvora_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearSessionCookie() {
  return "postvora_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function publicUser(user) {
  return user ? {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture || null,
    provider: user.provider,
    signedInAt: user.signedInAt
  } : null;
}

function isAdminUser(user, db) {
  if (!user) return false;
  const adminEmails = String(process.env.ADMIN_EMAIL || "")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length) return adminEmails.includes(String(user.email || "").toLowerCase());
  const users = Object.values(db.users || {});
  return users.length <= 1 || users[0]?.id === user.id;
}

function getSessionUser(req, db) {
  const sessionId = parseCookies(req).postvora_session;
  if (!sessionId || !db.sessions[sessionId]) return null;
  const session = db.sessions[sessionId];
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    delete db.sessions[sessionId];
    return null;
  }
  return db.users[session.userId] || null;
}

function createSession(db, user) {
  const sessionId = crypto.randomBytes(32).toString("base64url");
  db.sessions[sessionId] = {
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
  };
  return sessionId;
}

function upsertUser(db, input) {
  const id = input.id || crypto.randomUUID();
  const existing = db.users[id] || {};
  const user = {
    id,
    name: input.name || existing.name || input.email.split("@")[0],
    email: input.email,
    picture: input.picture || existing.picture || null,
    provider: input.provider,
    signedInAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
  db.users[id] = user;
  db.profile.owner = user.name;
  return user;
}

function postInsights(post, index = 0) {
  return post.insights || null;
}

function publicPost(post, index = 0) {
  return {
    ...post,
    insights: postInsights(post, index)
  };
}

function googleAuthConfig() {
  return {
    clientId: process.env.GOOGLE_AUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: `${APP_URL}/auth/callback/google`
  };
}

async function buildGoogleLoginUrl() {
  const config = googleAuthConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Add GOOGLE_AUTH_CLIENT_ID/SECRET or GOOGLE_CLIENT_ID/SECRET in .env");
  }
  const db = readDb();
  const state = crypto.randomBytes(24).toString("hex");
  db.authStates[state] = {
    provider: "google",
    createdAt: new Date().toISOString(),
    redirectUri: config.redirectUri
  };
  await writeDb(db);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function completeGoogleLogin(code, state) {
  const config = googleAuthConfig();
  const db = readDb();
  const authState = db.authStates[state];
  if (!authState || authState.provider !== "google") throw new Error("Invalid Google login state");
  delete db.authStates[state];

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: authState.redirectUri
    })
  });
  const token = await parseTokenResponse(tokenResponse);
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` }
  });
  const profile = await parseTokenResponse(profileResponse);
  if (!profile.email) throw new Error("Google did not return an email address");

  const user = upsertUser(db, {
    id: `google:${profile.sub}`,
    name: profile.name,
    email: profile.email,
    picture: profile.picture,
    provider: "google"
  });
  const sessionId = createSession(db, user);
  addEvent(db, "auth", `${user.name} signed in with Google`, { provider: "google" });
  await writeDb(db);
  return { user, sessionId };
}

function getConfigured(provider) {
  return Boolean(getClientId(provider) && getClientSecret(provider));
}

function getClientId(provider) {
  return process.env[provider.clientIdEnv] || (provider.fallbackClientIdEnv ? process.env[provider.fallbackClientIdEnv] : "");
}

function getClientSecret(provider) {
  return process.env[provider.clientSecretEnv] || (provider.fallbackClientSecretEnv ? process.env[provider.fallbackClientSecretEnv] : "");
}

function logoUrl(provider) {
  const hex = provider.logoSlug === "x" || provider.logoSlug === "threads" ? "ffffff" : provider.color.replace("#", "");
  return `https://cdn.simpleicons.org/${provider.logoSlug}/${hex}`;
}

function providerList() {
  const db = readDb();
  return Object.entries(providers).map(([id, provider]) => {
    const connection = db.connections[id];
    return {
      id,
      name: provider.name,
      handle: provider.handle,
      icon: provider.icon,
      color: provider.color,
      logoUrl: logoUrl(provider),
      scopes: provider.scopes,
      supports: provider.supports,
      configured: getConfigured(provider),
      connected: Boolean(connection),
      mode: connection ? connection.mode : null,
      connectedAt: connection ? connection.connectedAt : null,
      accountName: connection ? connection.accountName : null,
      pages: connection ? publicPages(connection) : [],
      selectedPageId: connection ? connection.selectedPageId || null : null,
      instagramAccounts: connection ? publicInstagramAccounts(connection) : [],
      selectedInstagramId: connection ? connection.selectedInstagramId || null : null,
      linkedInTargets: connection ? publicLinkedInTargets(connection) : []
    };
  });
}

async function buildAuthUrl(providerId) {
  const provider = providers[providerId];
  const clientId = getClientId(provider);
  const db = readDb();
  const state = crypto.randomBytes(24).toString("hex");
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const redirectUri = `${APP_URL}/oauth/callback/${providerId}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scopes.join(" "),
    state
  });

  if (providerId === "x") {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }

  if (providerId === "youtube") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }

  if (providerId === "instagram") {
    params.set("enable_fb_login", "0");
    params.set("force_authentication", "1");
  }

  db.oauthStates[state] = {
    providerId,
    codeVerifier,
    redirectUri,
    createdAt: new Date().toISOString()
  };
  await writeDb(db);

  return `${provider.authUrl}?${params.toString()}`;
}

function encryptionKey() {
  return crypto.createHash("sha256").update(APP_SECRET).digest();
}

function encryptTokenPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
}

function decryptTokenPayload(payload) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

function publicPages(connection) {
  return Array.isArray(connection.pages)
    ? connection.pages.map(page => ({
        id: page.id,
        name: page.name,
        category: page.category || "Page",
        selected: page.id === connection.selectedPageId
      }))
    : [];
}

function publicInstagramAccounts(connection) {
  return Array.isArray(connection.instagramAccounts)
    ? connection.instagramAccounts.map(account => ({
        id: account.id,
        username: account.username,
        name: account.name || account.username,
        pageName: account.pageName,
        selected: account.id === connection.selectedInstagramId
      }))
    : [];
}

function publicLinkedInTargets(connection) {
  const profileTargets = connection.linkedInProfile
    ? [{
        id: "profile",
        type: "profile",
        name: connection.linkedInProfile.name || connection.accountName || "LinkedIn Profile",
        urn: `urn:li:person:${connection.linkedInMemberId}`
      }]
    : [];
  const organizationTargets = Array.isArray(connection.linkedInOrganizations)
    ? connection.linkedInOrganizations.map(org => ({
        id: org.id,
        type: "organization",
        name: org.name,
        urn: org.urn
      }))
    : [];
  const testTargets = [LINKEDIN_TEST_ORGANIZATION];
  const selected = Array.isArray(connection.selectedLinkedInTargets) && connection.selectedLinkedInTargets.length
    ? connection.selectedLinkedInTargets
    : ["profile"];

  return [...profileTargets, ...organizationTargets, ...testTargets].map(target => ({
    ...target,
    selected: selected.includes(target.id)
  }));
}

async function fetchFacebookPages(userAccessToken) {
  const params = new URLSearchParams({
    fields: "id,name,category,access_token",
    access_token: userAccessToken
  });
  const response = await fetch(`https://graph.facebook.com/v19.0/me/accounts?${params.toString()}`);
  const data = await parseTokenResponse(response);
  return Array.isArray(data.data)
    ? data.data
        .filter(page => page.id && page.access_token)
        .map(page => ({
          id: page.id,
          name: page.name || "Facebook Page",
          category: page.category || "Page",
          accessToken: encryptTokenPayload({ access_token: page.access_token })
        }))
    : [];
}

async function fetchInstagramAccounts(userAccessToken) {
  const params = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}",
    access_token: userAccessToken
  });
  const response = await fetch(`https://graph.facebook.com/v19.0/me/accounts?${params.toString()}`);
  const data = await parseTokenResponse(response);
  return Array.isArray(data.data)
    ? data.data
        .filter(page => page.instagram_business_account && page.instagram_business_account.id)
        .map(page => ({
          id: page.instagram_business_account.id,
          username: page.instagram_business_account.username || "instagram",
          name: page.instagram_business_account.name || page.instagram_business_account.username || "Instagram Account",
          pageId: page.id,
          pageName: page.name || "Facebook Page",
          pageAccessToken: page.access_token ? encryptTokenPayload({ access_token: page.access_token }) : null
        }))
    : [];
}

async function fetchInstagramProfile(accessToken, fallbackUserId) {
  const params = new URLSearchParams({
    fields: "user_id,username,account_type,name",
    access_token: accessToken
  });
  const response = await fetch(`https://graph.instagram.com/v25.0/me?${params.toString()}`);
  const data = await parseTokenResponse(response);
  return {
    id: String(data.user_id || fallbackUserId || data.id || ""),
    username: data.username || "instagram-account",
    name: data.name || data.username || "Instagram Account",
    accountType: data.account_type || "BUSINESS"
  };
}

async function fetchLinkedInProfile(accessToken) {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const data = await parseTokenResponse(response);
  return {
    id: data.sub,
    name: data.name || [data.given_name, data.family_name].filter(Boolean).join(" ") || "LinkedIn Member",
    email: data.email || null
  };
}

async function fetchLinkedInOrganizations(accessToken) {
  const aclsUrl = "https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organization~(id,localizedName,vanityName)))";
  const response = await fetch(aclsUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-restli-protocol-version": "2.0.0"
    }
  });
  const data = await parseTokenResponse(response);
  return Array.isArray(data.elements)
    ? data.elements
        .map(item => item["organization~"])
        .filter(Boolean)
        .map(org => ({
          id: String(org.id),
          name: org.localizedName || org.vanityName || `Organization ${org.id}`,
          urn: `urn:li:organization:${org.id}`
        }))
    : [];
}

async function mediaBufferFromUrl(mediaUrl) {
  const localPath = localUploadFromUrl(mediaUrl);
  if (localPath) {
    const ext = path.extname(localPath).toLowerCase();
    return {
      buffer: fs.readFileSync(localPath),
      mimeType: {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif"
      }[ext] || "application/octet-stream"
    };
  }

  if (!/^https:\/\//i.test(mediaUrl || "")) return null;
  const response = await fetch(mediaUrl);
  if (!response.ok) throw new Error("Could not download image for LinkedIn");
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: response.headers.get("content-type") || "application/octet-stream"
  };
}

function extensionForMime(type) {
  return {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  }[type] || "";
}

function localUploadFromUrl(mediaUrl) {
  if (!mediaUrl) return null;

  let pathname = mediaUrl;
  try {
    pathname = new URL(mediaUrl, APP_URL).pathname;
  } catch {
    pathname = mediaUrl;
  }

  if (!pathname.startsWith("/uploads/")) return null;
  const filePath = path.normalize(path.join(UPLOAD_DIR, pathname.replace(/^\/uploads\//, "")));
  if (!filePath.startsWith(UPLOAD_DIR)) return null;
  return fs.existsSync(filePath) ? filePath : null;
}

async function requestToken(providerId, code, oauthState) {
  const provider = providers[providerId];
  const clientId = getClientId(provider);
  const clientSecret = getClientSecret(provider);
  const redirectUri = oauthState.redirectUri;

  if (providerId === "instagram") {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code
    });
    const response = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    return parseTokenResponse(response);
  }

  if (providerId === "facebook" || providerId === "threads") {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code
    });
    if (providerId === "threads") params.set("grant_type", "authorization_code");
    const response = await fetch(`${provider.tokenUrl}?${params.toString()}`);
    return parseTokenResponse(response);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });

  const headers = { "content-type": "application/x-www-form-urlencoded" };

  if (providerId === "tiktok") {
    body.set("client_key", clientId);
    body.set("client_secret", clientSecret);
  } else if (providerId === "x") {
    body.set("client_id", clientId);
    body.set("code_verifier", oauthState.codeVerifier);
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else if (providerId === "pinterest") {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  }

  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers,
    body
  });
  return parseTokenResponse(response);
}

async function parseTokenResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = Object.fromEntries(new URLSearchParams(text));
  }
  if (!response.ok) {
    const message = data.error_description || data.error_message || data.error || "Token exchange failed";
    throw new Error(message);
  }
  return data;
}

async function completeOAuthConnection(providerId, code, state) {
  const db = readDb();
  const provider = providers[providerId];
  const oauthState = db.oauthStates[state];

  if (!oauthState || oauthState.providerId !== providerId) throw new Error("Invalid or expired OAuth state");
  if (!getConfigured(provider)) throw new Error(`${provider.name} credentials are missing`);

  const tokenPayload = await requestToken(providerId, code, oauthState);
  const pages = providerId === "facebook" && tokenPayload.access_token
    ? await fetchFacebookPages(tokenPayload.access_token)
    : [];
  const instagramProfile = providerId === "instagram" && tokenPayload.access_token
    ? await fetchInstagramProfile(tokenPayload.access_token, tokenPayload.user_id)
    : null;
  const linkedInProfile = providerId === "linkedin" && tokenPayload.access_token
    ? await fetchLinkedInProfile(tokenPayload.access_token)
    : null;
  const linkedInOrganizations = providerId === "linkedin" && tokenPayload.access_token
    ? await fetchLinkedInOrganizations(tokenPayload.access_token).catch(() => [])
    : [];
  const instagramAccounts = instagramProfile
    ? [{
        id: instagramProfile.id,
        username: instagramProfile.username,
        name: instagramProfile.name,
        accountType: instagramProfile.accountType,
        pageId: null,
        pageName: "Instagram Login"
      }]
    : [];
  delete db.oauthStates[state];
  db.connections[providerId] = {
    providerId,
    mode: "oauth",
    accountName: instagramProfile
      ? `@${instagramProfile.username}`
      : linkedInProfile
        ? linkedInProfile.name
        : `${db.profile.name} ${provider.handle}`,
    tokenRef: `encrypted:${crypto.randomBytes(12).toString("hex")}`,
    token: encryptTokenPayload(tokenPayload),
    tokenType: tokenPayload.token_type || "Bearer",
    expiresAt: tokenPayload.expires_in
      ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString()
      : null,
    pages,
    selectedPageId: pages[0] ? pages[0].id : null,
    instagramAccounts,
    selectedInstagramId: instagramAccounts[0] ? instagramAccounts[0].id : null,
    linkedInMemberId: linkedInProfile ? linkedInProfile.id : null,
    linkedInProfile,
    linkedInOrganizations,
    selectedLinkedInTargets: ["profile"],
    scopes: provider.scopes,
    connectedAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString()
  };
  addEvent(db, "connection", `${provider.name} account linked with OAuth`, { providerId, mode: "oauth" });
  await writeDb(db);
}

function getPostStatus(scheduleDate) {
  if (!scheduleDate) return "published";
  return new Date(scheduleDate).getTime() > Date.now() ? "scheduled" : "ready";
}

function normalizePlatforms(payloadPlatforms, db) {
  if (Array.isArray(payloadPlatforms) && payloadPlatforms.length) return payloadPlatforms;
  return Object.keys(db.connections);
}

function buildResults(platforms, db, scheduleDate, mediaUrl = "") {
  return platforms.map(providerId => {
    const provider = providers[providerId];
    const connection = db.connections[providerId];
    if (!provider) return { providerId, ok: false, status: "failed", message: "Unknown platform" };
    if (!connection) return { providerId, ok: false, status: "blocked", message: `${provider.name} is not linked` };
    if (providerId === "facebook" && !connection.selectedPageId) {
      return {
        providerId,
        platform: provider.name,
        ok: false,
        status: "blocked",
        message: "Reconnect Facebook and select a Page before publishing"
      };
    }
    if (providerId === "instagram") {
      if (!connection.selectedInstagramId) {
        return {
          providerId,
          platform: provider.name,
          ok: false,
          status: "blocked",
          message: "Reconnect Instagram before publishing"
        };
      }
      if (!scheduleDate && (!mediaUrl || !/^https:\/\//i.test(mediaUrl))) {
        return {
          providerId,
          platform: provider.name,
          ok: false,
          status: "blocked",
          message: "Instagram requires a public HTTPS image or video URL"
        };
      }
    }

    return {
      providerId,
      platform: provider.name,
      ok: true,
      status: scheduleDate ? "queued" : "published",
      mode: connection.mode,
      message: `${provider.name} API adapter is ready for live publishing`
    };
  });
}

async function publishFacebook(post, connection) {
  const page = Array.isArray(connection.pages)
    ? connection.pages.find(item => item.id === connection.selectedPageId)
    : null;
  if (!page) throw new Error("No Facebook Page selected");

  const pageToken = decryptTokenPayload(page.accessToken).access_token;
  const localMediaPath = localUploadFromUrl(post.mediaUrl);

  if (localMediaPath) {
    const fileBuffer = fs.readFileSync(localMediaPath);
    const mimeType = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif"
    }[path.extname(localMediaPath).toLowerCase()] || "application/octet-stream";
    const form = new FormData();
    form.set("caption", post.text);
    form.set("access_token", pageToken);
    form.set("source", new Blob([fileBuffer], { type: mimeType }), path.basename(localMediaPath));

    const response = await fetch(`https://graph.facebook.com/v19.0/${page.id}/photos`, {
      method: "POST",
      body: form
    });
    const data = await parseTokenResponse(response);
    return {
      externalId: data.post_id || data.id,
      pageId: page.id,
      pageName: page.name
    };
  }

  const body = new URLSearchParams({
    message: post.text,
    access_token: pageToken
  });

  if (post.mediaUrl && /^https?:\/\//i.test(post.mediaUrl)) {
    body.set("link", post.mediaUrl);
  }

  const response = await fetch(`https://graph.facebook.com/v19.0/${page.id}/feed`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await parseTokenResponse(response);
  return {
    externalId: data.id,
    pageId: page.id,
    pageName: page.name
  };
}

async function publishInstagram(post, connection) {
  if (!connection.selectedInstagramId) throw new Error("No Instagram account selected");
  if (!post.mediaUrl || !/^https:\/\//i.test(post.mediaUrl)) {
    throw new Error("Instagram requires a public HTTPS image URL");
  }

  const tokenPayload = decryptTokenPayload(connection.token);
  const accessToken = tokenPayload.access_token;
  const mediaUrl = post.mediaUrl;
  const isVideo = /\.(mp4|mov)(\?|$)/i.test(mediaUrl);
  const createBody = new URLSearchParams({
    caption: post.text,
    access_token: accessToken
  });

  if (isVideo) {
    createBody.set("media_type", "REELS");
    createBody.set("video_url", mediaUrl);
  } else {
    createBody.set("image_url", mediaUrl);
  }

  const createResponse = await fetch(`https://graph.instagram.com/v25.0/${connection.selectedInstagramId}/media`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: createBody
  });
  const container = await parseTokenResponse(createResponse);
  if (!container.id) throw new Error("Instagram did not return a media container ID");

  const publishBody = new URLSearchParams({
    creation_id: container.id,
    access_token: accessToken
  });
  const publishResponse = await fetch(`https://graph.instagram.com/v25.0/${connection.selectedInstagramId}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: publishBody
  });
  const published = await parseTokenResponse(publishResponse);

  return {
    externalId: published.id,
    accountId: connection.selectedInstagramId,
    accountName: connection.accountName || "Instagram"
  };
}

async function uploadLinkedInImage(accessToken, ownerUrn, mediaUrl) {
  const media = await mediaBufferFromUrl(mediaUrl);
  if (!media) return null;
  if (!media.mimeType.startsWith("image/")) throw new Error("LinkedIn image upload requires an image file");

  const registerResponse = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-restli-protocol-version": "2.0.0"
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner: ownerUrn,
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent"
          }
        ]
      }
    })
  });
  const registered = await parseTokenResponse(registerResponse);
  const uploadMechanism = registered.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"];
  const uploadUrl = uploadMechanism.uploadUrl;
  const asset = registered.value.asset;

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": media.mimeType
    },
    body: media.buffer
  });
  if (!uploadResponse.ok) throw new Error("LinkedIn image upload failed");
  return asset;
}

async function publishLinkedInToOwner(post, accessToken, ownerUrn, ownerName) {
  const shareContent = {
    shareCommentary: { text: post.text },
    shareMediaCategory: "NONE"
  };

  const imageAsset = post.mediaUrl ? await uploadLinkedInImage(accessToken, ownerUrn, post.mediaUrl) : null;
  if (imageAsset) {
    shareContent.shareMediaCategory = "IMAGE";
    shareContent.media = [
      {
        status: "READY",
        media: imageAsset,
        title: { text: post.campaign || "Image" }
      }
    ];
  } else if (post.mediaUrl && /^https:\/\//i.test(post.mediaUrl) && !post.mediaUrl.includes("/uploads/")) {
    shareContent.shareMediaCategory = "ARTICLE";
    shareContent.media = [
      {
        status: "READY",
        originalUrl: post.mediaUrl,
        title: { text: post.campaign || "Shared link" }
      }
    ];
  }

  const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-restli-protocol-version": "2.0.0"
    },
    body: JSON.stringify({
      author: ownerUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": shareContent
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
      }
    })
  });

  const text = await response.text();
  if (!response.ok) {
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
    throw new Error(data.message || data.serviceErrorCode || "LinkedIn publish failed");
  }

  return {
    externalId: response.headers.get("x-restli-id") || text || "linkedin-post",
    accountName: ownerName
  };
}

async function publishLinkedIn(post, connection) {
  const tokenPayload = decryptTokenPayload(connection.token);
  const accessToken = tokenPayload.access_token;
  let memberId = connection.linkedInMemberId;
  let profileName = connection.accountName || "LinkedIn Profile";

  if (!memberId) {
    const profile = await fetchLinkedInProfile(accessToken);
    memberId = profile.id;
    profileName = profile.name;
  }
  if (!memberId) throw new Error("LinkedIn member profile was not returned");

  const targets = publicLinkedInTargets(connection).filter(target => target.selected);
  const usableTargets = targets.length
    ? targets
    : [{ id: "profile", type: "profile", name: profileName, urn: `urn:li:person:${memberId}` }];

  const published = [];
  for (const target of usableTargets) {
    published.push(await publishLinkedInToOwner(post, accessToken, target.urn, target.name));
  }

  return {
    externalId: published.map(item => item.externalId).join(","),
    accountName: published.map(item => item.accountName).join(" + ")
  };
}

async function publishImmediatePost(post, db) {
  const results = [];

  for (const result of post.results) {
    if (!result.ok) {
      results.push(result);
      continue;
    }

    if (!["facebook", "instagram", "linkedin"].includes(result.providerId)) {
      results.push({
        ...result,
        status: "ready",
        message: `${result.platform} is connected. Live adapter is pending for this platform.`
      });
      continue;
    }

    try {
      const published = result.providerId === "facebook"
        ? await publishFacebook(post, db.connections.facebook)
        : result.providerId === "instagram"
          ? await publishInstagram(post, db.connections.instagram)
          : await publishLinkedIn(post, db.connections.linkedin);
      results.push({
        ...result,
        status: "published",
        externalId: published.externalId,
        message: `Published to ${published.pageName || published.accountName}`
      });
    } catch (error) {
      results.push({
        ...result,
        ok: false,
        status: "failed",
        message: error.message || `${result.platform} publish failed`
      });
    }
  }

  return results;
}

function analytics(db) {
  const posts = db.posts;
  const published = posts.filter(post => post.status === "published" || post.status === "ready").length;
  const scheduled = posts.filter(post => post.status === "scheduled").length;
  const linked = Object.keys(db.connections).length;
  const insightRows = posts.map(postInsights).filter(Boolean);
  const impressions = insightRows.reduce((sum, insight) => sum + Number(insight.reach || 0), 0);
  const engagements = insightRows.reduce((sum, insight) => sum + Number(insight.engagement || 0), 0);
  const clicks = insightRows.reduce((sum, insight) => sum + Number(insight.clicks || 0), 0);

  return {
    linked,
    scheduled,
    published,
    totalPosts: posts.length,
    impressions,
    engagements,
    clicks,
    syncedInsights: insightRows.length,
    engagementRate: impressions ? `${((engagements / impressions) * 100).toFixed(1)}%` : "0.0%",
    topPlatform:
      Object.keys(db.connections)[0] && providers[Object.keys(db.connections)[0]]
        ? providers[Object.keys(db.connections)[0]].name
        : "Connect an account"
  };
}

function adminSummary(db) {
  const users = Object.values(db.users || {}).filter(user =>
    user.provider === "google" && !String(user.email || "").endsWith("@postvora.com")
  );
  const posts = db.posts || [];
  const results = posts.flatMap(post => post.results || []);
  const okJobs = results.filter(result => result.ok).length;
  const failedJobs = results.filter(result => result.status === "failed" || result.ok === false).length;
  const paidUsers = users.filter(user => user.plan === "paid" || user.subscriptionStatus === "active").length;

  return {
    users: {
      total: users.length,
      google: users.filter(user => user.provider === "google").length,
      email: users.filter(user => user.provider === "email").length
    },
    billing: {
      free: Math.max(0, users.length - paidUsers),
      paid: paidUsers,
      mrr: null,
      source: "Billing not connected"
    },
    usage: {
      posts: posts.length,
      published: posts.filter(post => post.status === "published" || post.status === "ready").length,
      scheduled: posts.filter(post => post.status === "scheduled").length
    },
    platforms: {
      jobs: results.length,
      ok: okJobs,
      failed: failedJobs,
      successRate: results.length ? `${((okJobs / results.length) * 100).toFixed(1)}%` : "0.0%"
    },
    recentUsers: users.slice(-8).reverse().map(publicUser),
    audit: (db.events || []).slice(0, 10)
  };
}

async function handleApi(req, res, url) {
  await initializeDb();

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const db = readDb();
    const user = getSessionUser(req, db);
    return sendJson(res, 200, {
      profile: db.profile,
      user: publicUser(user),
      isAdmin: isAdminUser(user, db),
      providers: providerList(),
      posts: db.posts.slice(0, 50).map(publicPost),
      automations: db.automations,
      events: db.events.slice(0, 30),
      analytics: analytics(db)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/providers") {
    return sendJson(res, 200, { providers: providerList() });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/summary") {
    const db = readDb();
    const user = getSessionUser(req, db);
    if (!isAdminUser(user, db)) return sendJson(res, 403, { error: "Admin access required. Set ADMIN_EMAIL in .env." });
    return sendJson(res, 200, adminSummary(db));
  }

  if (req.method === "POST" && url.pathname === "/api/auth/google/start") {
    return sendJson(res, 200, { authUrl: await buildGoogleLoginUrl() });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/email-start") {
    const payload = jsonBody(await readBody(req));
    const email = String(payload.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "Enter a valid email address" });

    const db = readDb();
    const code = String(crypto.randomInt(100000, 999999));
    db.emailVerifications[email] = {
      codeHash: crypto.createHash("sha256").update(`${code}:${APP_SECRET}`).digest("hex"),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
      attempts: 0
    };
    addEvent(db, "auth", `Verification code requested for ${email}`, { provider: "email" });
    await writeDb(db);
    return sendJson(res, 200, {
      ok: true,
      message: "Verification code sent",
      devCode: APP_URL.includes("localhost") ? code : undefined
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/email-verify") {
    const payload = jsonBody(await readBody(req));
    const email = String(payload.email || "").trim().toLowerCase();
    const code = String(payload.code || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "Enter a valid email address" });
    if (!/^\d{6}$/.test(code)) return sendJson(res, 400, { error: "Enter the 6-digit verification code" });

    const db = readDb();
    const verification = db.emailVerifications[email];
    if (!verification) return sendJson(res, 400, { error: "Request a new verification code" });
    if (new Date(verification.expiresAt).getTime() < Date.now()) {
      delete db.emailVerifications[email];
      await writeDb(db);
      return sendJson(res, 400, { error: "Verification code expired" });
    }
    verification.attempts += 1;
    if (verification.attempts > 5) {
      delete db.emailVerifications[email];
      await writeDb(db);
      return sendJson(res, 429, { error: "Too many attempts. Request a new code" });
    }
    const codeHash = crypto.createHash("sha256").update(`${code}:${APP_SECRET}`).digest("hex");
    if (codeHash !== verification.codeHash) {
      await writeDb(db);
      return sendJson(res, 400, { error: "Invalid verification code" });
    }
    delete db.emailVerifications[email];
    const user = upsertUser(db, {
      id: `email:${email}`,
      name: email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase()),
      email,
      provider: "email"
    });
    const sessionId = createSession(db, user);
    addEvent(db, "auth", `${user.name} verified email login`, { provider: "email" });
    await writeDb(db);
    return sendJson(res, 200, { user: publicUser(user) }, { "set-cookie": sessionCookie(sessionId) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const db = readDb();
    const sessionId = parseCookies(req).postvora_session;
    if (sessionId) delete db.sessions[sessionId];
    await writeDb(db);
    return sendJson(res, 200, { ok: true }, { "set-cookie": clearSessionCookie() });
  }

  if (req.method === "POST" && url.pathname === "/api/media") {
    const payload = jsonBody(await readBody(req));
    const name = String(payload.name || "upload").replace(/[^a-z0-9._-]/gi, "-").slice(0, 80);
    const type = String(payload.type || "");
    const dataUrl = String(payload.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);

    if (!match) return sendJson(res, 400, { error: "Upload a JPG, PNG, WebP, or GIF image" });
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 8_000_000) return sendJson(res, 400, { error: "Image must be 8 MB or smaller" });
    if (type && type !== mimeType) return sendJson(res, 400, { error: "Image type mismatch" });

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const fileName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${path.basename(name, path.extname(name))}${extensionForMime(mimeType)}`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    fs.writeFileSync(filePath, buffer);

    return sendJson(res, 200, {
      url: `/uploads/${fileName}`,
      absoluteUrl: `${APP_URL}/uploads/${fileName}`,
      fileName,
      type: mimeType,
      size: buffer.length
    });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/connect/")) {
    const providerId = url.pathname.split("/").pop();
    const provider = providers[providerId];
    if (!provider) return sendJson(res, 404, { error: "Unknown provider" });

    if (!getConfigured(provider)) {
      return sendJson(res, 409, {
        error: `${provider.name} OAuth credentials are missing. Add ${provider.clientIdEnv} and ${provider.clientSecretEnv} in .env, then restart the server.`
      });
    }

    return sendJson(res, 200, { mode: "oauth", authUrl: await buildAuthUrl(providerId) });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/disconnect/")) {
    const providerId = url.pathname.split("/").pop();
    if (!providers[providerId]) return sendJson(res, 404, { error: "Unknown provider" });

    const db = readDb();
    delete db.connections[providerId];
    addEvent(db, "connection", `${providers[providerId].name} account unlinked`, { providerId });
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/connections/facebook/page") {
    const payload = jsonBody(await readBody(req));
    const db = readDb();
    const connection = db.connections.facebook;
    if (!connection) return sendJson(res, 404, { error: "Facebook is not connected" });

    const pageId = String(payload.pageId || "");
    const page = Array.isArray(connection.pages) ? connection.pages.find(item => item.id === pageId) : null;
    if (!page) return sendJson(res, 404, { error: "Facebook Page not found. Reconnect Facebook to refresh Pages." });

    connection.selectedPageId = page.id;
    connection.accountName = page.name;
    connection.lastSyncAt = new Date().toISOString();
    addEvent(db, "connection", `Facebook Page selected: ${page.name}`, { providerId: "facebook", pageId: page.id });
    await writeDb(db);
    return sendJson(res, 200, { provider: providerList().find(item => item.id === "facebook") });
  }

  if (req.method === "POST" && url.pathname === "/api/connections/facebook/sync-pages") {
    const db = readDb();
    const connection = db.connections.facebook;
    if (!connection) return sendJson(res, 404, { error: "Facebook is not connected" });

    const tokenPayload = decryptTokenPayload(connection.token);
    const pages = await fetchFacebookPages(tokenPayload.access_token);
    if (!pages.length) {
      return sendJson(res, 400, {
        error: "No Facebook Pages returned. Check pages_show_list permission, Page access, and app role/tester status."
      });
    }

    connection.pages = pages;
    connection.selectedPageId = pages[0].id;
    connection.accountName = pages[0].name;
    connection.lastSyncAt = new Date().toISOString();
    addEvent(db, "connection", `${pages.length} Facebook Page${pages.length === 1 ? "" : "s"} synced`, {
      providerId: "facebook"
    });
    await writeDb(db);
    return sendJson(res, 200, { pages: publicPages(connection) });
  }

  if (req.method === "POST" && url.pathname === "/api/connections/instagram/sync-accounts") {
    const db = readDb();
    const connection = db.connections.instagram;
    if (!connection) return sendJson(res, 404, { error: "Instagram is not connected. Click Connect on Instagram first." });

    const tokenPayload = decryptTokenPayload(connection.token);
    const profile = await fetchInstagramProfile(tokenPayload.access_token, tokenPayload.user_id);
    const accounts = [{
      id: profile.id,
      username: profile.username,
      name: profile.name,
      accountType: profile.accountType,
      pageId: null,
      pageName: "Instagram Login"
    }];

    connection.instagramAccounts = accounts;
    connection.selectedInstagramId = accounts[0].id;
    connection.accountName = `@${accounts[0].username}`;
    connection.lastSyncAt = new Date().toISOString();
    addEvent(db, "connection", `${accounts.length} Instagram account${accounts.length === 1 ? "" : "s"} synced`, {
      providerId: "instagram"
    });
    await writeDb(db);
    return sendJson(res, 200, { accounts: publicInstagramAccounts(connection) });
  }

  if (req.method === "POST" && url.pathname === "/api/connections/instagram/account") {
    const payload = jsonBody(await readBody(req));
    const db = readDb();
    const connection = db.connections.instagram;
    if (!connection) return sendJson(res, 404, { error: "Instagram is not connected" });

    const accountId = String(payload.accountId || "");
    const account = Array.isArray(connection.instagramAccounts)
      ? connection.instagramAccounts.find(item => item.id === accountId)
      : null;
    if (!account) return sendJson(res, 404, { error: "Instagram account not found. Sync accounts again." });

    connection.selectedInstagramId = account.id;
    connection.accountName = `@${account.username}`;
    connection.lastSyncAt = new Date().toISOString();
    addEvent(db, "connection", `Instagram account selected: @${account.username}`, {
      providerId: "instagram",
      accountId: account.id
    });
    await writeDb(db);
    return sendJson(res, 200, { provider: providerList().find(item => item.id === "instagram") });
  }

  if (req.method === "POST" && url.pathname === "/api/connections/linkedin/sync-profile") {
    const db = readDb();
    const connection = db.connections.linkedin;
    if (!connection) return sendJson(res, 404, { error: "LinkedIn is not connected" });

    const tokenPayload = decryptTokenPayload(connection.token);
    const profile = await fetchLinkedInProfile(tokenPayload.access_token);
    const organizations = await fetchLinkedInOrganizations(tokenPayload.access_token).catch(error => {
      connection.linkedInOrganizationSyncError = error.message;
      return Array.isArray(connection.linkedInOrganizations) ? connection.linkedInOrganizations : [];
    });
    connection.linkedInMemberId = profile.id;
    connection.linkedInProfile = profile;
    connection.linkedInOrganizations = organizations;
    connection.selectedLinkedInTargets = Array.isArray(connection.selectedLinkedInTargets) && connection.selectedLinkedInTargets.length
      ? connection.selectedLinkedInTargets
      : ["profile"];
    connection.accountName = profile.name;
    connection.lastSyncAt = new Date().toISOString();
    addEvent(db, "connection", `LinkedIn profile synced: ${profile.name}`, { providerId: "linkedin" });
    await writeDb(db);
    return sendJson(res, 200, { profile, organizations: publicLinkedInTargets(connection) });
  }

  if (req.method === "POST" && url.pathname === "/api/connections/linkedin/targets") {
    const payload = jsonBody(await readBody(req));
    const db = readDb();
    const connection = db.connections.linkedin;
    if (!connection) return sendJson(res, 404, { error: "LinkedIn is not connected" });

    const available = publicLinkedInTargets(connection).map(target => target.id);
    const targets = Array.isArray(payload.targets) ? payload.targets.map(String).filter(id => available.includes(id)) : [];
    if (!targets.length) return sendJson(res, 400, { error: "Select at least one LinkedIn target" });

    connection.selectedLinkedInTargets = [...new Set(targets)];
    connection.lastSyncAt = new Date().toISOString();
    addEvent(db, "connection", `LinkedIn targets updated`, { providerId: "linkedin", targets: connection.selectedLinkedInTargets });
    await writeDb(db);
    return sendJson(res, 200, { targets: publicLinkedInTargets(connection) });
  }

  if (req.method === "POST" && url.pathname === "/api/post") {
    const payload = jsonBody(await readBody(req));
    const text = String(payload.text || "").trim();
    const mediaUrl = String(payload.mediaUrl || "").trim();
    const campaign = String(payload.campaign || "General").trim();
    const scheduleDate = String(payload.scheduleDate || "").trim();

    if (!text) return sendJson(res, 400, { error: "Post text is required" });
    const db = readDb();
    const selectedPlatforms = normalizePlatforms(payload.platforms, db);
    if (!selectedPlatforms.length) return sendJson(res, 400, { error: "Connect or select at least one platform" });

    let results = buildResults(selectedPlatforms, db, scheduleDate, mediaUrl);
    const initialOkCount = results.filter(result => result.ok).length;
    const status = initialOkCount ? getPostStatus(scheduleDate) : "blocked";
    const post = {
      id: crypto.randomUUID(),
      text,
      mediaUrl,
      campaign,
      platforms: selectedPlatforms,
      status,
      scheduleDate: scheduleDate || null,
      results,
      createdAt: new Date().toISOString()
    };
    if (status === "published") {
      post.results = await publishImmediatePost(post, db);
      const publishedCount = post.results.filter(result => result.status === "published").length;
      if (!publishedCount) post.status = "blocked";
      results = post.results;
    }
    const okCount = results.filter(result => result.ok).length;
    db.posts.unshift(post);
    addEvent(db, status === "scheduled" ? "schedule" : "post", `${okCount}/${selectedPlatforms.length} platform jobs created`, {
      postId: post.id,
      status
    });
    await writeDb(db);

    return sendJson(res, 200, { post, results, analytics: analytics(db) });
  }

  if (req.method === "GET" && url.pathname === "/api/posts") {
    const db = readDb();
    return sendJson(res, 200, { posts: db.posts.slice(0, 50).map(publicPost) });
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/posts\/[^/]+$/)) {
    const postId = url.pathname.split("/").pop();
    const payload = jsonBody(await readBody(req));
    const db = readDb();
    const post = db.posts.find(item => item.id === postId);
    if (!post) return sendJson(res, 404, { error: "Post not found" });

    const text = String(payload.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "Post text is required" });
    const mediaUrl = String(payload.mediaUrl || "").trim();
    const campaign = String(payload.campaign || post.campaign || "General").trim();
    const scheduleDate = String(payload.scheduleDate || "").trim();
    const selectedPlatforms = normalizePlatforms(payload.platforms || post.platforms, db);
    if (!selectedPlatforms.length) return sendJson(res, 400, { error: "Select at least one connected platform" });

    const wasPublished = post.status === "published";
    post.text = text;
    post.mediaUrl = mediaUrl;
    post.campaign = campaign;
    post.scheduleDate = scheduleDate || null;
    post.platforms = selectedPlatforms;
    if (!wasPublished) {
      post.results = buildResults(selectedPlatforms, db, post.scheduleDate, mediaUrl);
      const okCount = post.results.filter(result => result.ok).length;
      post.status = okCount ? getPostStatus(post.scheduleDate) : "blocked";
      if (post.status === "published") post.status = "ready";
    }
    post.updatedAt = new Date().toISOString();
    addEvent(db, "post", wasPublished ? "Published post record updated" : "Post updated", { postId, status: post.status });
    await writeDb(db);
    return sendJson(res, 200, { post: publicPost(post), analytics: analytics(db) });
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/posts\/[^/]+\/publish$/)) {
    const postId = url.pathname.split("/").slice(-2)[0];
    const db = readDb();
    const post = db.posts.find(item => item.id === postId);
    if (!post) return sendJson(res, 404, { error: "Post not found" });
    if (!["scheduled", "blocked", "ready"].includes(post.status)) return sendJson(res, 400, { error: "This post cannot be published now" });

    post.status = "published";
    post.scheduleDate = null;
    post.results = await publishImmediatePost(post, db);
    if (!post.results.filter(result => result.status === "published").length) post.status = "blocked";
    post.publishedAt = new Date().toISOString();
    addEvent(db, "post", "Scheduled post published now", { postId, status: post.status });
    await writeDb(db);
    return sendJson(res, 200, { post: publicPost(post), analytics: analytics(db) });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/automations/")) {
    const automationId = url.pathname.split("/").pop();
    const payload = jsonBody(await readBody(req));
    const db = readDb();
    const automation = db.automations.find(item => item.id === automationId);
    if (!automation) return sendJson(res, 404, { error: "Automation not found" });

    automation.enabled = Boolean(payload.enabled);
    addEvent(db, "automation", `${automation.name} ${automation.enabled ? "enabled" : "paused"}`, { automationId });
    await writeDb(db);
    return sendJson(res, 200, { automation });
  }

  if (req.method === "POST" && url.pathname === "/api/profile/regenerate-key") {
    const db = readDb();
    db.profile.apiKey = `pp_${crypto.randomBytes(18).toString("hex")}`;
    addEvent(db, "developer", "API key regenerated");
    await writeDb(db);
    return sendJson(res, 200, { profile: db.profile });
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(req, res, url) {
  if (url.pathname.startsWith("/uploads/")) {
    const uploadName = decodeURIComponent(url.pathname.replace(/^\/uploads\//, ""));
    const filePath = path.normalize(path.join(UPLOAD_DIR, uploadName));
    if (!filePath.startsWith(UPLOAD_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    return fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif"
      }[ext] || "application/octet-stream";
      res.writeHead(200, { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" });
      res.end(content);
    });
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const ext = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";

    res.writeHead(200, { "content-type": contentType });
    res.end(content);
  });
}

async function appHandler(req, res) {
  try {
    const url = new URL(req.url, APP_URL);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, app: "Postvora" });
    }

    if (req.method === "GET" && url.pathname === "/auth/callback/google") {
      await initializeDb();
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error") || url.searchParams.get("error_description");

      if (error) return redirect(res, `/?oauth_error=${encodeURIComponent(error)}`);
      if (!code || !state) return redirect(res, "/?oauth_error=Invalid%20Google%20callback");

      try {
        const { sessionId } = await completeGoogleLogin(code, state);
        res.writeHead(302, {
          location: "/?login=google",
          "set-cookie": sessionCookie(sessionId)
        });
        return res.end();
      } catch (callbackError) {
        return redirect(res, `/?oauth_error=${encodeURIComponent(callbackError.message)}`);
      }
    }

    if (req.method === "GET" && url.pathname.startsWith("/oauth/callback/")) {
      await initializeDb();
      const providerId = url.pathname.split("/").pop();
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error") || url.searchParams.get("error_description");

      if (error) return redirect(res, `/?oauth_error=${encodeURIComponent(error)}#accounts`);
      if (!providers[providerId] || !code || !state) return redirect(res, "/?oauth_error=Invalid%20OAuth%20callback#accounts");

      try {
        await completeOAuthConnection(providerId, code, state);
        return redirect(res, "/?connected=1#accounts");
      } catch (callbackError) {
        return redirect(res, `/?oauth_error=${encodeURIComponent(callbackError.message)}#accounts`);
      }
    }

    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

if (require.main === module) {
  const server = http.createServer(appHandler);
  server.listen(PORT, () => {
    console.log(`Postvora running at ${APP_URL}`);
    initializeDb().catch(error => {
      console.error("Database initialization failed:", error.message);
    });
  });
}

module.exports = appHandler;

