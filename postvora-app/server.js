"use strict";
const http = require("http");
const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnvFile();

const PORT       = Number(process.env.PORT || 3000);
const APP_URL    = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(PUBLIC_DIR, "uploads"));
const APP_SECRET = process.env.APP_SECRET || "change-this-secret-before-production";
const SB_URL     = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY     = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_EMAILS = String(process.env.ADMIN_EMAIL || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

// Short-lived in-memory maps (cleared on restart — fine for OAuth flows)
const oauthStates = new Map();  // state -> { providerId, codeVerifier, redirectUri, userId }
const authStates  = new Map();  // state -> { provider, redirectUri }
const emailCodes  = new Map();  // email -> { codeHash, expiresAt, attempts }

// ─────────────────────────────────────────────────────────────────────────────
// ENV LOADER
// ─────────────────────────────────────────────────────────────────────────────
function loadEnvFile() {
  const p = path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE REST HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function sbFetch(endpoint, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${endpoint}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      authorization: `Bearer ${SB_KEY}`,
      "content-type": "application/json",
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body?.message || body?.error || body?.hint || text || "Supabase error";
    throw new Error(msg);
  }
  return body;
}

function sbSelect(table, filters = {}, { select = "*", order, limit } = {}) {
  const q = new URLSearchParams({ select });
  for (const [k, v] of Object.entries(filters)) q.set(k, v);
  if (order) q.set("order", order);
  if (limit)  q.set("limit", String(limit));
  return sbFetch(`${table}?${q}`);
}

async function sbOne(table, filters = {}, select = "*") {
  const rows = await sbSelect(table, filters, { select, limit: 1 });
  return rows?.[0] ?? null;
}

function sbInsert(table, row) {
  return sbFetch(table, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(row)
  });
}

function sbUpsert(table, row, onConflict) {
  return sbFetch(`${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row)
  });
}

function sbUpdate(table, filters, updates) {
  const q = new URLSearchParams(filters);
  return sbFetch(`${table}?${q}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(updates)
  });
}

function sbDelete(table, filters) {
  return sbFetch(`${table}?${new URLSearchParams(filters)}`, { method: "DELETE" });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDERS
// ─────────────────────────────────────────────────────────────────────────────
const PROVIDERS = {
  facebook: {
    name: "Facebook", handle: "Pages", icon: "f", color: "#1877f2", logoSlug: "facebook",
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    clientIdEnv: "META_CLIENT_ID", clientSecretEnv: "META_CLIENT_SECRET",
    scopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
    supports: ["text", "image", "video", "link", "analytics"]
  },
  instagram: {
    name: "Instagram", handle: "Creator + Business", icon: "ig", color: "#e4405f", logoSlug: "instagram",
    authUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    clientIdEnv: "INSTAGRAM_CLIENT_ID", clientSecretEnv: "INSTAGRAM_CLIENT_SECRET",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    supports: ["image", "video", "reels", "analytics"]
  },
  linkedin: {
    name: "LinkedIn", handle: "Company + Member", icon: "in", color: "#0a66c2", logoSlug: "linkedin",
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    clientIdEnv: "LINKEDIN_CLIENT_ID", clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    scopes: ["openid", "profile", "w_member_social", "r_organization_social", "w_organization_social"],
    supports: ["text", "image", "video", "article", "analytics"]
  },
  x: {
    name: "X", handle: "Twitter / X", icon: "x", color: "#111111", logoSlug: "x",
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    clientIdEnv: "X_CLIENT_ID", clientSecretEnv: "X_CLIENT_SECRET",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    supports: ["text", "image", "threads"]
  },
  tiktok: {
    name: "TikTok", handle: "Business", icon: "tk", color: "#111827", logoSlug: "tiktok",
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    clientIdEnv: "TIKTOK_CLIENT_ID", clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    scopes: ["user.info.basic", "video.publish", "video.upload"],
    supports: ["video", "shorts"]
  },
  youtube: {
    name: "YouTube", handle: "Channel", icon: "yt", color: "#ff0000", logoSlug: "youtube",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID", clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    supports: ["video", "shorts", "analytics"]
  },
  pinterest: {
    name: "Pinterest", handle: "Boards", icon: "p", color: "#bd081c", logoSlug: "pinterest",
    authUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    clientIdEnv: "PINTEREST_CLIENT_ID", clientSecretEnv: "PINTEREST_CLIENT_SECRET",
    scopes: ["pins:read", "pins:write", "boards:read"],
    supports: ["image", "link", "analytics"]
  },
  threads: {
    name: "Threads", handle: "Profile", icon: "th", color: "#000000", logoSlug: "threads",
    authUrl: "https://threads.net/oauth/authorize",
    tokenUrl: "https://graph.threads.net/oauth/access_token",
    clientIdEnv: "THREADS_CLIENT_ID", clientSecretEnv: "THREADS_CLIENT_SECRET",
    scopes: ["threads_basic", "threads_content_publish"],
    supports: ["text", "image", "video"]
  }
};

function getClientId(p)     { return process.env[p.clientIdEnv] || ""; }
function getClientSecret(p) { return process.env[p.clientSecretEnv] || ""; }
function isConfigured(p)    { return Boolean(getClientId(p) && getClientSecret(p)); }
function logoUrl(p) {
  const hex = (p.logoSlug === "x" || p.logoSlug === "threads") ? "ffffff" : p.color.replace("#", "");
  return `https://cdn.simpleicons.org/${p.logoSlug}/${hex}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENCRYPTION  (AES-256-GCM for OAuth tokens)
// ─────────────────────────────────────────────────────────────────────────────
function encKey() { return crypto.createHash("sha256").update(APP_SECRET).digest(); }

function encryptToken(payload) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc    = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: enc.toString("base64") };
}

function decryptToken(enc) {
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(enc.iv, "base64"));
  d.setAuthTag(Buffer.from(enc.tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(enc.data, "base64")), d.final()]).toString("utf8"));
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}
function redirect(res, target) { res.writeHead(302, { location: target }); res.end(); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 16_000_000) { req.destroy(); reject(new Error("Body too large")); } });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
function jsonBody(raw) { try { return JSON.parse(raw || "{}"); } catch { return {}; } }
function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "").split(";").map(s => s.trim()).filter(Boolean).map(s => {
      const i = s.indexOf("=");
      return i < 0 ? [s, ""] : [s.slice(0, i), decodeURIComponent(s.slice(i + 1))];
    })
  );
}
function sessionCookie(id, maxAge = 86400 * 30) {
  const secure = APP_URL.startsWith("https://") ? "; Secure" : "";
  return `postvora_session=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function clearCookie() { return "postvora_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"; }

// ─────────────────────────────────────────────────────────────────────────────
// AUTH HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function getSessionUser(req) {
  if (!SB_URL || !SB_KEY) return null;
  const sessionId = parseCookies(req).postvora_session;
  if (!sessionId) return null;
  const session = await sbOne("sessions", { "id": `eq.${sessionId}` });
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    await sbDelete("sessions", { "id": `eq.${sessionId}` }).catch(() => {});
    return null;
  }
  return sbOne("app_users", { "id": `eq.${session.user_id}` });
}

async function createSession(userId) {
  const id = crypto.randomBytes(32).toString("base64url");
  await sbInsert("sessions", {
    id,
    user_id: userId,
    expires_at: new Date(Date.now() + 86400 * 30 * 1000).toISOString(),
    created_at: new Date().toISOString()
  });
  return id;
}

async function upsertUser({ provider, providerId, email, name, picture }) {
  const rows = await sbUpsert("app_users", {
    provider,
    provider_user_id: providerId,
    email,
    name,
    picture_url: picture || null,
    last_login_at: new Date().toISOString(),
    updated_at:   new Date().toISOString()
  }, "email");
  return Array.isArray(rows) ? rows[0] : rows;
}

function isAdmin(user) {
  if (!user) return false;
  if (ADMIN_EMAILS.length) return ADMIN_EMAILS.includes((user.email || "").toLowerCase());
  return false;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, picture: user.picture_url, provider: user.provider, plan: user.plan || "free" };
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────
async function addEvent(userId, type, message, details = {}) {
  await sbInsert("events", {
    user_id: userId, type, message, details, created_at: new Date().toISOString()
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE LOGIN
// ─────────────────────────────────────────────────────────────────────────────
function googleCfg() {
  return {
    clientId:     process.env.GOOGLE_AUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:  `${APP_URL}/auth/callback/google`
  };
}

async function buildGoogleUrl() {
  const cfg = googleCfg();
  if (!cfg.clientId) throw new Error("Set GOOGLE_AUTH_CLIENT_ID in .env");
  const state = crypto.randomBytes(24).toString("hex");
  authStates.set(state, { provider: "google", redirectUri: cfg.redirectUri });
  setTimeout(() => authStates.delete(state), 10 * 60 * 1000);
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri,
    response_type: "code", scope: "openid email profile",
    access_type: "offline", prompt: "select_account", state
  })}`;
}

async function completeGoogleLogin(code, state) {
  const entry = authStates.get(state);
  if (!entry || entry.provider !== "google") throw new Error("Invalid login state");
  authStates.delete(state);
  const cfg = googleCfg();
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, grant_type: "authorization_code", redirect_uri: cfg.redirectUri })
  });
  const token = await parseApiRes(tokenRes);
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` }
  });
  const profile = await parseApiRes(profileRes);
  if (!profile.email) throw new Error("Google did not return an email");
  const user = await upsertUser({ provider: "google", providerId: `google:${profile.sub}`, email: profile.email, name: profile.name, picture: profile.picture });
  const sessionId = await createSession(user.id);
  await addEvent(user.id, "auth", `${user.name} signed in with Google`);
  return { user, sessionId };
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL OTP LOGIN
// ─────────────────────────────────────────────────────────────────────────────
async function startEmailLogin(email) {
  const code = String(crypto.randomInt(100000, 999999));
  emailCodes.set(email, {
    codeHash: crypto.createHash("sha256").update(`${code}:${APP_SECRET}`).digest("hex"),
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0
  });
  setTimeout(() => emailCodes.delete(email), 10 * 60 * 1000);
  return code;
}

async function verifyEmailLogin(email, code) {
  const entry = emailCodes.get(email);
  if (!entry)                     throw new Error("Request a new verification code");
  if (Date.now() > entry.expiresAt) { emailCodes.delete(email); throw new Error("Code expired. Request a new one"); }
  entry.attempts++;
  if (entry.attempts > 5) { emailCodes.delete(email); throw new Error("Too many attempts. Request a new code"); }
  const hash = crypto.createHash("sha256").update(`${code}:${APP_SECRET}`).digest("hex");
  if (hash !== entry.codeHash) throw new Error("Invalid verification code");
  emailCodes.delete(email);
  const name = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const user = await upsertUser({ provider: "email", providerId: `email:${email}`, email, name, picture: null });
  const sessionId = await createSession(user.id);
  await addEvent(user.id, "auth", `${name} verified email login`);
  return { user, sessionId };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL OAUTH FLOW
// ─────────────────────────────────────────────────────────────────────────────
async function buildOAuthUrl(providerId, userId) {
  const p = PROVIDERS[providerId];
  if (!isConfigured(p)) throw new Error(`${p.name} credentials not set. Add ${p.clientIdEnv} and ${p.clientSecretEnv} to .env`);
  const state        = crypto.randomBytes(24).toString("hex");
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const redirectUri  = `${APP_URL}/oauth/callback/${providerId}`;
  oauthStates.set(state, { providerId, codeVerifier, redirectUri, userId });
  setTimeout(() => oauthStates.delete(state), 10 * 60 * 1000);
  const params = new URLSearchParams({
    client_id: getClientId(p), redirect_uri: redirectUri,
    response_type: "code", scope: p.scopes.join(" "), state
  });
  if (providerId === "x") {
    params.set("code_challenge", crypto.createHash("sha256").update(codeVerifier).digest("base64url"));
    params.set("code_challenge_method", "S256");
  }
  if (providerId === "youtube")   { params.set("access_type", "offline"); params.set("prompt", "consent"); }
  if (providerId === "instagram") { params.set("enable_fb_login", "0"); params.set("force_authentication", "1"); }
  return `${p.authUrl}?${params}`;
}

async function exchangeToken(providerId, code, oauthState) {
  const p            = PROVIDERS[providerId];
  const clientId     = getClientId(p);
  const clientSecret = getClientSecret(p);
  const redirectUri  = oauthState.redirectUri;

  if (providerId === "instagram") {
    const res = await fetch(p.tokenUrl, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code })
    });
    return parseApiRes(res);
  }
  if (providerId === "facebook" || providerId === "threads") {
    const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
    if (providerId === "threads") params.set("grant_type", "authorization_code");
    return parseApiRes(await fetch(`${p.tokenUrl}?${params}`));
  }
  const body    = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (providerId === "tiktok") {
    body.set("client_key", clientId); body.set("client_secret", clientSecret);
  } else if (providerId === "x") {
    body.set("client_id", clientId); body.set("code_verifier", oauthState.codeVerifier);
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else if (providerId === "pinterest") {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", clientId); body.set("client_secret", clientSecret);
  }
  return parseApiRes(await fetch(p.tokenUrl, { method: "POST", headers, body }));
}

async function parseApiRes(res) {
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = Object.fromEntries(new URLSearchParams(text)); }
  if (!res.ok) throw new Error(data.error_description || data.error_message || data.error || data.message || "API error");
  return data;
}

async function completeOAuthConnection(providerId, code, state) {
  const oauthState = oauthStates.get(state);
  if (!oauthState || oauthState.providerId !== providerId) throw new Error("Invalid or expired OAuth state");
  oauthStates.delete(state);

  const p       = PROVIDERS[providerId];
  const userId  = oauthState.userId;
  const token   = await exchangeToken(providerId, code, oauthState);
  let accountName = "Connected";
  const pd = {
    scopes: p.scopes,
    connectedAt: new Date().toISOString(),
    expiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null
  };

  if (providerId === "facebook" && token.access_token) {
    const pages = await fetchFbPages(token.access_token);
    pd.pages          = pages;
    pd.selectedPageId = pages[0]?.id || null;
    accountName       = pages[0]?.name || "Facebook Page";
  }
  if (providerId === "instagram" && token.access_token) {
    const profile = await fetchIgProfile(token.access_token, token.user_id);
    pd.instagramAccounts    = [{ id: profile.id, username: profile.username, name: profile.name, accountType: profile.accountType }];
    pd.selectedInstagramId  = profile.id;
    accountName             = `@${profile.username}`;
  }
  if (providerId === "linkedin" && token.access_token) {
    const [profile, orgs] = await Promise.all([
      fetchLinkedInProfile(token.access_token),
      fetchLinkedInOrgs(token.access_token).catch(() => [])
    ]);
    pd.linkedInMemberId       = profile.id;
    pd.linkedInProfile        = profile;
    pd.linkedInOrganizations  = orgs;
    pd.selectedLinkedInTargets = ["profile"];
    accountName = profile.name;
  }
  if (providerId === "x" && token.access_token) {
    const xp = await fetchXProfile(token.access_token);
    pd.xUserId = xp.id;
    accountName = `@${xp.username}`;
  }
  if (providerId === "tiktok" && token.access_token) {
    const ttp = await fetchTikTokProfile(token.access_token);
    pd.tiktokOpenId = ttp.data?.user?.open_id || token.open_id || "";
    accountName = ttp.data?.user?.display_name || "TikTok Account";
  }
  if (providerId === "threads" && token.access_token) {
    const thp = await fetchThreadsProfile(token.access_token);
    pd.threadsUserId = thp.id;
    accountName = `@${thp.username || "threads"}`;
  }
  if (providerId === "youtube" && token.access_token) {
    accountName = "YouTube Channel";
  }
  if (providerId === "pinterest" && token.access_token) {
    accountName = "Pinterest Account";
  }

  await sbUpsert("connections", {
    user_id:         userId,
    provider_id:     providerId,
    mode:            "oauth",
    account_name:    accountName,
    token_encrypted: encryptToken(token),
    provider_data:   pd,
    connected_at:    new Date().toISOString(),
    updated_at:      new Date().toISOString()
  }, "user_id,provider_id");

  await addEvent(userId, "connection", `${p.name} connected — ${accountName}`, { providerId });
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM PROFILE FETCHERS
// ─────────────────────────────────────────────────────────────────────────────
async function fetchFbPages(accessToken) {
  const res  = await fetch(`https://graph.facebook.com/v19.0/me/accounts?${new URLSearchParams({ fields: "id,name,category,access_token", access_token: accessToken })}`);
  const data = await parseApiRes(res);
  return (data.data || []).filter(pg => pg.id && pg.access_token).map(pg => ({
    id: pg.id, name: pg.name || "Facebook Page", category: pg.category || "Page",
    accessToken: encryptToken({ access_token: pg.access_token })
  }));
}

async function fetchIgProfile(accessToken, fallbackId) {
  const res  = await fetch(`https://graph.instagram.com/v25.0/me?${new URLSearchParams({ fields: "user_id,username,account_type,name", access_token: accessToken })}`);
  const data = await parseApiRes(res);
  return { id: String(data.user_id || fallbackId || data.id || ""), username: data.username || "instagram", name: data.name || data.username || "Instagram", accountType: data.account_type || "BUSINESS" };
}

async function fetchLinkedInProfile(accessToken) {
  const res  = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  const data = await parseApiRes(res);
  return { id: data.sub, name: data.name || [data.given_name, data.family_name].filter(Boolean).join(" ") || "LinkedIn Member", email: data.email };
}

async function fetchLinkedInOrgs(accessToken) {
  const url = "https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organization~(id,localizedName,vanityName)))";
  const res  = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, "x-restli-protocol-version": "2.0.0" } });
  const data = await parseApiRes(res);
  return (data.elements || []).map(e => e["organization~"]).filter(Boolean).map(o => ({
    id: String(o.id), name: o.localizedName || o.vanityName || `Org ${o.id}`, urn: `urn:li:organization:${o.id}`
  }));
}

async function fetchXProfile(accessToken) {
  const res  = await fetch("https://api.twitter.com/2/users/me", { headers: { authorization: `Bearer ${accessToken}` } });
  const data = await parseApiRes(res);
  return { id: data.data?.id || "", username: data.data?.username || "twitter" };
}

async function fetchTikTokProfile(accessToken) {
  const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  return parseApiRes(res);
}

async function fetchThreadsProfile(accessToken) {
  const res = await fetch(`https://graph.threads.net/v1.0/me?${new URLSearchParams({ fields: "id,username", access_token: accessToken })}`);
  return parseApiRes(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function localUploadPath(mediaUrl) {
  if (!mediaUrl) return null;
  let pathname;
  try { pathname = new URL(mediaUrl, APP_URL).pathname; } catch { pathname = mediaUrl; }
  if (!pathname.startsWith("/uploads/")) return null;
  const fp = path.normalize(path.join(UPLOAD_DIR, pathname.replace(/^\/uploads\//, "")));
  if (!fp.startsWith(UPLOAD_DIR)) return null;
  return fs.existsSync(fp) ? fp : null;
}

function mimeForPath(fp) {
  return { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" }[path.extname(fp).toLowerCase()] || "application/octet-stream";
}

function mimeToExt(mime) {
  return { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" }[mime] || "";
}

async function mediaBuffer(mediaUrl) {
  const lp = localUploadPath(mediaUrl);
  if (lp) return { buffer: fs.readFileSync(lp), mimeType: mimeForPath(lp) };
  if (!/^https?:\/\//i.test(mediaUrl || "")) return null;
  const res = await fetch(mediaUrl);
  if (!res.ok) throw new Error("Could not download media");
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") || "application/octet-stream" };
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM PUBLISHERS
// ─────────────────────────────────────────────────────────────────────────────
async function publishFacebook(post, conn) {
  const pd   = conn.provider_data || {};
  const page = (pd.pages || []).find(pg => pg.id === pd.selectedPageId);
  if (!page) throw new Error("No Facebook Page selected. Go to Accounts → Facebook → select a Page.");
  const pageToken = decryptToken(page.accessToken).access_token;
  const lp = localUploadPath(post.media_url);
  if (lp) {
    const buf  = fs.readFileSync(lp);
    const mime = mimeForPath(lp);
    const form = new FormData();
    form.set("caption", post.text);
    form.set("access_token", pageToken);
    form.set("source", new Blob([buf], { type: mime }), path.basename(lp));
    const res  = await fetch(`https://graph.facebook.com/v19.0/${page.id}/photos`, { method: "POST", body: form });
    const data = await parseApiRes(res);
    return { externalId: data.post_id || data.id, accountName: page.name };
  }
  const body = new URLSearchParams({ message: post.text, access_token: pageToken });
  if (post.media_url && /^https?:\/\//i.test(post.media_url)) body.set("link", post.media_url);
  const res  = await fetch(`https://graph.facebook.com/v19.0/${page.id}/feed`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body
  });
  const data = await parseApiRes(res);
  return { externalId: data.id, accountName: page.name };
}

async function publishInstagram(post, conn) {
  const pd = conn.provider_data || {};
  if (!pd.selectedInstagramId) throw new Error("No Instagram account selected. Go to Accounts → Instagram → Sync.");
  if (!post.media_url || !/^https:\/\//i.test(post.media_url)) throw new Error("Instagram requires a public HTTPS image or video URL.");
  const accessToken = decryptToken(conn.token_encrypted).access_token;
  const isVideo     = /\.(mp4|mov)(\?|$)/i.test(post.media_url);
  const createBody  = new URLSearchParams({ caption: post.text, access_token: accessToken });
  if (isVideo) { createBody.set("media_type", "REELS"); createBody.set("video_url", post.media_url); }
  else createBody.set("image_url", post.media_url);
  const container = await parseApiRes(await fetch(`https://graph.instagram.com/v25.0/${pd.selectedInstagramId}/media`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: createBody
  }));
  if (!container.id) throw new Error("Instagram did not return a container ID");
  const published = await parseApiRes(await fetch(`https://graph.instagram.com/v25.0/${pd.selectedInstagramId}/media_publish`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: container.id, access_token: accessToken })
  }));
  return { externalId: published.id, accountName: conn.account_name };
}

async function publishLinkedIn(post, conn) {
  const pd    = conn.provider_data || {};
  const token = decryptToken(conn.token_encrypted).access_token;
  let memberId = pd.linkedInMemberId;
  if (!memberId) { const p = await fetchLinkedInProfile(token); memberId = p.id; }
  if (!memberId) throw new Error("LinkedIn member ID not found. Sync LinkedIn profile.");
  const targets = getLinkedInTargets(pd).filter(t => t.selected);
  const use = targets.length ? targets : [{ urn: `urn:li:person:${memberId}`, name: conn.account_name }];
  const results = [];
  for (const target of use) results.push(await publishLinkedInToTarget(post, token, target.urn, target.name));
  return { externalId: results.map(r => r.externalId).join(","), accountName: results.map(r => r.name).join(" + ") };
}

async function publishLinkedInToTarget(post, token, ownerUrn, ownerName) {
  const shareContent = { shareCommentary: { text: post.text }, shareMediaCategory: "NONE" };
  if (post.media_url) {
    const asset = await uploadLinkedInImage(token, ownerUrn, post.media_url).catch(() => null);
    if (asset) {
      shareContent.shareMediaCategory = "IMAGE";
      shareContent.media = [{ status: "READY", media: asset, title: { text: post.campaign || "Image" } }];
    } else if (/^https:\/\//i.test(post.media_url) && !post.media_url.includes("/uploads/")) {
      shareContent.shareMediaCategory = "ARTICLE";
      shareContent.media = [{ status: "READY", originalUrl: post.media_url, title: { text: post.campaign || "Link" } }];
    }
  }
  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-restli-protocol-version": "2.0.0" },
    body: JSON.stringify({
      author: ownerUrn, lifecycleState: "PUBLISHED",
      specificContent: { "com.linkedin.ugc.ShareContent": shareContent },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
    })
  });
  const text = await res.text();
  if (!res.ok) { let d = {}; try { d = JSON.parse(text); } catch {} throw new Error(d.message || "LinkedIn publish failed"); }
  return { externalId: res.headers.get("x-restli-id") || "li-post", name: ownerName };
}

async function uploadLinkedInImage(token, ownerUrn, mediaUrl) {
  const media = await mediaBuffer(mediaUrl);
  if (!media) throw new Error("Could not load image for LinkedIn");
  if (!media.mimeType.startsWith("image/")) throw new Error("LinkedIn image must be an image file");
  const regRes = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-restli-protocol-version": "2.0.0" },
    body: JSON.stringify({ registerUploadRequest: { recipes: ["urn:li:digitalmediaRecipe:feedshare-image"], owner: ownerUrn, serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }] } })
  });
  const reg  = await parseApiRes(regRes);
  const mech = reg.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"];
  await fetch(mech.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": media.mimeType }, body: media.buffer });
  return reg.value.asset;
}

async function publishX(post, conn) {
  const token = decryptToken(conn.token_encrypted).access_token;
  const res   = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ text: post.text.slice(0, 280) })
  });
  const data = await parseApiRes(res);
  return { externalId: data.data?.id || "tweet", accountName: conn.account_name };
}

async function publishTikTok(post, conn) {
  if (!post.media_url || !/^https:\/\//i.test(post.media_url)) throw new Error("TikTok requires a public HTTPS video URL (.mp4 or .mov)");
  if (!/\.(mp4|mov)(\?|$)/i.test(post.media_url)) throw new Error("TikTok only supports video posts (.mp4 or .mov)");
  const token = decryptToken(conn.token_encrypted).access_token;
  const res   = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: { title: post.text.slice(0, 2200), privacy_level: "PUBLIC_TO_EVERYONE", disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 },
      source_info: { source: "PULL_FROM_URL", video_url: post.media_url }
    })
  });
  const data = await parseApiRes(res);
  if (!data.data?.publish_id) throw new Error("TikTok did not return a publish_id");
  return { externalId: data.data.publish_id, accountName: conn.account_name };
}

async function publishThreads(post, conn) {
  const pd = conn.provider_data || {};
  if (!pd.threadsUserId) throw new Error("Threads user ID missing. Reconnect Threads.");
  const token      = decryptToken(conn.token_encrypted).access_token;
  const createBody = new URLSearchParams({ text: post.text, access_token: token });
  if (post.media_url && /^https:\/\//i.test(post.media_url)) {
    const isVideo = /\.(mp4|mov)(\?|$)/i.test(post.media_url);
    createBody.set("media_type", isVideo ? "VIDEO" : "IMAGE");
    createBody.set(isVideo ? "video_url" : "image_url", post.media_url);
  } else {
    createBody.set("media_type", "TEXT");
  }
  const container = await parseApiRes(await fetch(`https://graph.threads.net/v1.0/${pd.threadsUserId}/threads`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: createBody
  }));
  if (!container.id) throw new Error("Threads did not return a container ID");
  const published = await parseApiRes(await fetch(`https://graph.threads.net/v1.0/${pd.threadsUserId}/threads_publish`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: container.id, access_token: token })
  }));
  return { externalId: published.id || "threads-post", accountName: conn.account_name };
}

async function publishPinterest(post, conn) {
  if (!post.media_url || !/^https:\/\//i.test(post.media_url)) throw new Error("Pinterest requires a public HTTPS image URL");
  const token = decryptToken(conn.token_encrypted).access_token;
  const res   = await fetch("https://api.pinterest.com/v5/pins", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      title: (post.campaign || post.text).slice(0, 100),
      description: post.text.slice(0, 500),
      media_source: { source_type: "image_url", url: post.media_url }
    })
  });
  const data = await parseApiRes(res);
  return { externalId: data.id || "pin", accountName: conn.account_name };
}

async function dispatchPublish(providerId, post, conn) {
  switch (providerId) {
    case "facebook":  return publishFacebook(post, conn);
    case "instagram": return publishInstagram(post, conn);
    case "linkedin":  return publishLinkedIn(post, conn);
    case "x":         return publishX(post, conn);
    case "tiktok":    return publishTikTok(post, conn);
    case "threads":   return publishThreads(post, conn);
    case "pinterest": return publishPinterest(post, conn);
    default: throw new Error(`Publisher for ${providerId} is coming soon`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LINKEDIN TARGETS HELPER
// ─────────────────────────────────────────────────────────────────────────────
function getLinkedInTargets(pd) {
  const sel = pd.selectedLinkedInTargets || ["profile"];
  const profileTargets = pd.linkedInProfile
    ? [{ id: "profile", type: "profile", name: pd.linkedInProfile.name || "LinkedIn Profile", urn: `urn:li:person:${pd.linkedInMemberId}`, selected: sel.includes("profile") }]
    : [];
  const orgTargets = (pd.linkedInOrganizations || []).map(o => ({
    id: o.id, type: "organization", name: o.name, urn: o.urn, selected: sel.includes(o.id)
  }));
  return [...profileTargets, ...orgTargets];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION PUBLIC VIEW
// ─────────────────────────────────────────────────────────────────────────────
function publicConn(conn) {
  if (!conn) return { connected: false, mode: null, accountName: null, connectedAt: null, pages: [], selectedPageId: null, instagramAccounts: [], selectedInstagramId: null, linkedInTargets: [] };
  const pd = conn.provider_data || {};
  return {
    connected:          true,
    mode:               conn.mode,
    accountName:        conn.account_name,
    connectedAt:        conn.connected_at,
    pages:              (pd.pages || []).map(pg => ({ id: pg.id, name: pg.name, category: pg.category || "Page", selected: pg.id === pd.selectedPageId })),
    selectedPageId:     pd.selectedPageId || null,
    instagramAccounts:  (pd.instagramAccounts || []).map(a => ({ id: a.id, username: a.username, name: a.name, selected: a.id === pd.selectedInstagramId })),
    selectedInstagramId: pd.selectedInstagramId || null,
    linkedInTargets:    getLinkedInTargets(pd)
  };
}

async function getUserProviders(userId) {
  const conns   = await sbSelect("connections", { "user_id": `eq.${userId}` }).catch(() => []);
  const connMap = Object.fromEntries((conns || []).map(c => [c.provider_id, c]));
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id, name: p.name, handle: p.handle, icon: p.icon, color: p.color,
    logoUrl: logoUrl(p), scopes: p.scopes, supports: p.supports,
    configured: isConfigured(p),
    ...publicConn(connMap[id] || null)
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// POST HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function publicPost(p) {
  return {
    id:          p.id,
    text:        p.text,
    mediaUrl:    p.media_url,
    campaign:    p.campaign,
    platforms:   p.platforms || [],
    status:      p.status,
    scheduleDate: p.schedule_date,
    publishedAt:  p.published_at,
    insights:    p.insights,
    results:     (p.post_results || []).map(r => ({
      providerId: r.provider_id,
      platform:   r.platform,
      ok:         r.ok,
      status:     r.status,
      message:    r.message,
      externalId: r.external_id
    })),
    createdAt: p.created_at
  };
}

async function getUserPosts(userId) {
  const posts = await sbSelect("posts", { "user_id": `eq.${userId}` }, { order: "created_at.desc", limit: 50, select: "*,post_results(*)" }).catch(() => []);
  return (posts || []).map(publicPost);
}

async function getUserAnalytics(userId) {
  const [posts, conns] = await Promise.all([
    sbSelect("posts",       { "user_id": `eq.${userId}` }, { select: "status,insights" }).catch(() => []),
    sbSelect("connections", { "user_id": `eq.${userId}` }, { select: "provider_id" }).catch(() => [])
  ]);
  const pl = posts  || [];
  const cl = conns  || [];
  const impressions  = pl.reduce((s, p) => s + Number(p.insights?.reach || 0), 0);
  const engagements  = pl.reduce((s, p) => s + Number(p.insights?.engagement || 0), 0);
  return {
    linked:      cl.length,
    totalPosts:  pl.length,
    published:   pl.filter(p => p.status === "published" || p.status === "ready").length,
    scheduled:   pl.filter(p => p.status === "scheduled").length,
    impressions,
    engagements,
    engagementRate: impressions ? `${((engagements / impressions) * 100).toFixed(1)}%` : "0.0%",
    topPlatform: cl[0] ? PROVIDERS[cl[0].provider_id]?.name || cl[0].provider_id : "Connect an account"
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLISH IMMEDIATELY — called for non-scheduled posts
// ─────────────────────────────────────────────────────────────────────────────
async function publishNow(post, connMap) {
  const results = [];
  for (const pid of (post.platforms || [])) {
    const conn = connMap[pid];
    if (!conn) {
      results.push({ providerId: pid, platform: PROVIDERS[pid]?.name || pid, ok: false, status: "blocked", message: `${pid} is not connected` });
      continue;
    }
    try {
      const published = await dispatchPublish(pid, post, conn);
      await sbUpsert("post_results", {
        post_id: post.id, provider_id: pid, platform: PROVIDERS[pid]?.name || pid,
        ok: true, status: "published", external_id: published.externalId || null,
        message: `Published to ${published.accountName || pid}`,
        updated_at: new Date().toISOString()
      }, "post_id,provider_id").catch(() => {});
      results.push({ providerId: pid, platform: PROVIDERS[pid]?.name || pid, ok: true, status: "published", message: `Published to ${published.accountName || pid}`, externalId: published.externalId });
    } catch (err) {
      await sbUpsert("post_results", {
        post_id: post.id, provider_id: pid, platform: PROVIDERS[pid]?.name || pid,
        ok: false, status: "failed", message: err.message,
        updated_at: new Date().toISOString()
      }, "post_id,provider_id").catch(() => {});
      results.push({ providerId: pid, platform: PROVIDERS[pid]?.name || pid, ok: false, status: "failed", message: err.message });
    }
  }
  const anyOk = results.some(r => r.ok && r.status === "published");
  await sbUpdate("posts", { "id": `eq.${post.id}` }, {
    status:       anyOk ? "published" : "blocked",
    published_at: anyOk ? new Date().toISOString() : null,
    updated_at:   new Date().toISOString()
  }).catch(() => {});
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULING WORKER
// ─────────────────────────────────────────────────────────────────────────────
async function runScheduler() {
  try {
    const duePosts = await sbSelect("posts",
      { "status": "eq.scheduled", "schedule_date": `lte.${new Date().toISOString()}` },
      { select: "*", limit: 20 }
    ).catch(() => []);
    if (!duePosts?.length) return;
    console.log(`[Scheduler] Processing ${duePosts.length} due post(s)`);
    for (const post of duePosts) {
      const conns   = post.user_id ? await sbSelect("connections", { "user_id": `eq.${post.user_id}` }).catch(() => []) : [];
      const connMap = Object.fromEntries((conns || []).map(c => [c.provider_id, c]));
      const results = await publishNow(post, connMap);
      const ok      = results.filter(r => r.ok && r.status === "published").length;
      if (post.user_id) await addEvent(post.user_id, "schedule", `Scheduled post processed: ${ok}/${post.platforms.length} platforms published`);
    }
  } catch (err) {
    console.error("[Scheduler] Error:", err.message);
  }
}

function startScheduler() {
  setInterval(runScheduler, 60_000);
  console.log("[Scheduler] Running — checks every 60 seconds");
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT AUTOMATIONS
// ─────────────────────────────────────────────────────────────────────────────
function defaultAutomations() {
  return [
    { id: crypto.randomUUID(), name: "Best-time scheduler", trigger_text: "When a post is saved as draft", action_text: "Suggest highest-engagement window", enabled: true },
    { id: crypto.randomUUID(), name: "UTM link builder",    trigger_text: "When a URL is detected in post",   action_text: "Append campaign tracking parameters", enabled: false }
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// API HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function handleApi(req, res, url) {

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const user = await getSessionUser(req);
    if (!user) {
      return sendJson(res, 200, {
        profile: { name: "Postvora", plan: "free", apiKey: null },
        user: null, isAdmin: false,
        providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, handle: p.handle, icon: p.icon, color: p.color, logoUrl: logoUrl(p), supports: p.supports, configured: isConfigured(p), connected: false, pages: [], selectedPageId: null, instagramAccounts: [], selectedInstagramId: null, linkedInTargets: [] })),
        posts: [], automations: defaultAutomations(), events: [],
        analytics: { linked: 0, totalPosts: 0, published: 0, scheduled: 0, impressions: 0, engagements: 0, engagementRate: "0.0%", topPlatform: "Connect an account" }
      });
    }
    const [providers, posts, eventsRows, analytics] = await Promise.all([
      getUserProviders(user.id),
      getUserPosts(user.id),
      sbSelect("events", { "user_id": `eq.${user.id}` }, { order: "created_at.desc", limit: 30 }).catch(() => []),
      getUserAnalytics(user.id)
    ]);
    const automations = await sbSelect("automations", { "user_id": `eq.${user.id}` }, { limit: 20 }).catch(() => []);
    return sendJson(res, 200, {
      profile:     { name: "Postvora Studio", plan: user.plan || "free", apiKey: `pp_${Buffer.from(user.id.replace(/-/g, ""), "hex").toString("base64url").slice(0, 32)}` },
      user:        publicUser(user),
      isAdmin:     isAdmin(user),
      providers,
      posts,
      automations: automations?.length ? automations : defaultAutomations(),
      events:      eventsRows || [],
      analytics
    });
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/auth/google/start") {
    return sendJson(res, 200, { authUrl: await buildGoogleUrl() });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/email-start") {
    const { email } = jsonBody(await readBody(req));
    const e = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return sendJson(res, 400, { error: "Enter a valid email address" });
    const code = await startEmailLogin(e);
    return sendJson(res, 200, { ok: true, message: "Verification code sent", devCode: APP_URL.includes("localhost") ? code : undefined });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/email-verify") {
    const { email, code } = jsonBody(await readBody(req));
    const e = String(email || "").trim().toLowerCase();
    const c = String(code  || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return sendJson(res, 400, { error: "Enter a valid email" });
    if (!/^\d{6}$/.test(c)) return sendJson(res, 400, { error: "Enter the 6-digit code" });
    try {
      const { user, sessionId } = await verifyEmailLogin(e, c);
      return sendJson(res, 200, { user: publicUser(user) }, { "set-cookie": sessionCookie(sessionId) });
    } catch (err) { return sendJson(res, 400, { error: err.message }); }
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const sid = parseCookies(req).postvora_session;
    if (sid) await sbDelete("sessions", { "id": `eq.${sid}` }).catch(() => {});
    return sendJson(res, 200, { ok: true }, { "set-cookie": clearCookie() });
  }

  // ── Providers list ─────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/providers") {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    return sendJson(res, 200, { providers: await getUserProviders(user.id) });
  }

  // ── Connect social platform ────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname.startsWith("/api/connect/")) {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const pid = url.pathname.split("/").pop();
    const p   = PROVIDERS[pid];
    if (!p)              return sendJson(res, 404, { error: "Unknown platform" });
    if (!isConfigured(p)) return sendJson(res, 409, { error: `${p.name} not configured. Add ${p.clientIdEnv} and ${p.clientSecretEnv} to .env` });
    return sendJson(res, 200, { mode: "oauth", authUrl: await buildOAuthUrl(pid, user.id) });
  }

  // ── Disconnect platform ────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname.startsWith("/api/disconnect/")) {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const pid = url.pathname.split("/").pop();
    if (!PROVIDERS[pid]) return sendJson(res, 404, { error: "Unknown platform" });
    await sbDelete("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.${pid}` });
    await addEvent(user.id, "connection", `${PROVIDERS[pid].name} disconnected`, { providerId: pid });
    return sendJson(res, 200, { ok: true });
  }

  // ── Facebook page management ───────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/connections/facebook/sync-pages") {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const conn = await sbOne("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.facebook` });
    if (!conn) return sendJson(res, 404, { error: "Facebook not connected" });
    const token = decryptToken(conn.token_encrypted).access_token;
    const pages = await fetchFbPages(token);
    if (!pages.length) return sendJson(res, 400, { error: "No Facebook Pages found. Make sure you granted pages_show_list permission." });
    const pd = { ...(conn.provider_data || {}), pages, selectedPageId: pages[0].id };
    await sbUpdate("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.facebook` }, { account_name: pages[0].name, provider_data: pd, updated_at: new Date().toISOString() });
    return sendJson(res, 200, { pages: pages.map(pg => ({ id: pg.id, name: pg.name, category: pg.category })) });
  }

  if (req.method === "POST" && url.pathname === "/api/connections/facebook/page") {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const { pageId } = jsonBody(await readBody(req));
    const conn = await sbOne("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.facebook` });
    if (!conn) return sendJson(res, 404, { error: "Facebook not connected" });
    const pd   = conn.provider_data || {};
    const page = (pd.pages || []).find(pg => pg.id === pageId);
    if (!page) return sendJson(res, 404, { error: "Page not found. Sync pages first." });
    pd.selectedPageId = page.id;
    await sbUpdate("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.facebook` }, { account_name: page.name, provider_data: pd, updated_at: new Date().toISOString() });
    return sendJson(res, 200, { ok: true, accountName: page.name });
  }

  // ── Instagram account management ───────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/connections/instagram/sync-accounts") {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const conn = await sbOne("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.instagram` });
    if (!conn) return sendJson(res, 404, { error: "Instagram not connected" });
    const token   = decryptToken(conn.token_encrypted).access_token;
    const profile = await fetchIgProfile(token, null);
    const pd = { ...(conn.provider_data || {}), instagramAccounts: [{ id: profile.id, username: profile.username, name: profile.name, accountType: profile.accountType }], selectedInstagramId: profile.id };
    await sbUpdate("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.instagram` }, { account_name: `@${profile.username}`, provider_data: pd, updated_at: new Date().toISOString() });
    return sendJson(res, 200, { accounts: [{ id: profile.id, username: profile.username }] });
  }

  if (req.method === "POST" && url.pathname === "/api/connections/instagram/account") {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const { accountId } = jsonBody(await readBody(req));
    const conn = await sbOne("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.instagram` });
    if (!conn) return sendJson(res, 404, { error: "Instagram not connected" });
    const pd   = conn.provider_data || {};
    const acct = (pd.instagramAccounts || []).find(a => a.id === accountId);
    if (!acct) return sendJson(res, 404, { error: "Account not found. Sync accounts first." });
    pd.selectedInstagramId = acct.id;
    await sbUpdate("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.instagram` }, { account_name: `@${acct.username}`, provider_data: pd, updated_at: new Date().toISOString() });
    return sendJson(res, 200, { ok: true });
  }

  // ── LinkedIn profile management ────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/connections/linkedin/sync-profile") {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const conn = await sbOne("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.linkedin` });
    if (!conn) return sendJson(res, 404, { error: "LinkedIn not connected" });
    const token = decryptToken(conn.token_encrypted).access_token;
    const [profile, orgs] = await Promise.all([fetchLinkedInProfile(token), fetchLinkedInOrgs(token).catch(() => [])]);
    const pd = { ...(conn.provider_data || {}), linkedInMemberId: profile.id, linkedInProfile: profile, linkedInOrganizations: orgs, selectedLinkedInTargets: ["profile"] };
    await sbUpdate("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.linkedin` }, { account_name: profile.name, provider_data: pd, updated_at: new Date().toISOString() });
    return sendJson(res, 200, { profile, targets: getLinkedInTargets(pd) });
  }

  if (req.method === "POST" && url.pathname === "/api/connections/linkedin/targets") {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const { targets } = jsonBody(await readBody(req));
    if (!Array.isArray(targets) || !targets.length) return sendJson(res, 400, { error: "Select at least one LinkedIn target" });
    const conn = await sbOne("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.linkedin` });
    if (!conn) return sendJson(res, 404, { error: "LinkedIn not connected" });
    const pd = { ...(conn.provider_data || {}), selectedLinkedInTargets: [...new Set(targets.map(String))] };
    await sbUpdate("connections", { "user_id": `eq.${user.id}`, "provider_id": `eq.linkedin` }, { provider_data: pd, updated_at: new Date().toISOString() });
    return sendJson(res, 200, { targets: getLinkedInTargets(pd) });
  }

  // ── Media upload ───────────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/media") {
    const payload = jsonBody(await readBody(req));
    const name    = String(payload.name || "upload").replace(/[^a-z0-9._-]/gi, "-").slice(0, 80);
    const dataUrl = String(payload.dataUrl || "");
    const match   = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (!match) return sendJson(res, 400, { error: "Upload a JPG, PNG, WebP, or GIF image" });
    const mimeType = match[1];
    const buffer   = Buffer.from(match[2], "base64");
    if (buffer.length > 8_000_000) return sendJson(res, 400, { error: "Image must be 8 MB or smaller" });
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const fileName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${path.basename(name, path.extname(name))}${mimeToExt(mimeType)}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
    return sendJson(res, 200, { url: `/uploads/${fileName}`, absoluteUrl: `${APP_URL}/uploads/${fileName}`, fileName, type: mimeType, size: buffer.length });
  }

  // ── Create post ────────────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/post") {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required to create posts" });
    const payload  = jsonBody(await readBody(req));
    const text     = String(payload.text || "").trim();
    const mediaUrl = String(payload.mediaUrl || payload.media_url || "").trim();
    const campaign = String(payload.campaign || "General").trim();
    const sched    = String(payload.scheduleDate || "").trim();
    if (!text) return sendJson(res, 400, { error: "Post text is required" });

    const conns   = await sbSelect("connections", { "user_id": `eq.${user.id}` }).catch(() => []);
    const connMap = Object.fromEntries((conns || []).map(c => [c.provider_id, c]));
    const platforms = Array.isArray(payload.platforms) && payload.platforms.length ? payload.platforms : Object.keys(connMap);
    if (!platforms.length) return sendJson(res, 400, { error: "Connect at least one platform first" });

    const isScheduled = Boolean(sched) && new Date(sched) > new Date();
    const postRows = await sbInsert("posts", {
      user_id:       user.id,
      text,
      media_url:     mediaUrl || null,
      campaign,
      platforms,
      status:        isScheduled ? "scheduled" : "ready",
      schedule_date: sched ? new Date(sched).toISOString() : null,
      created_at:    new Date().toISOString(),
      updated_at:    new Date().toISOString()
    });
    const post = Array.isArray(postRows) ? postRows[0] : postRows;

    // Seed post_results rows
    const resultSeeds = platforms.map(pid => ({
      post_id: post.id, provider_id: pid, platform: PROVIDERS[pid]?.name || pid,
      ok: Boolean(connMap[pid]),
      status: connMap[pid] ? (isScheduled ? "queued" : "pending") : "blocked",
      message: connMap[pid] ? (isScheduled ? `Scheduled for ${sched}` : "Pending publish") : `${pid} is not connected`,
      created_at: new Date().toISOString()
    }));
    await sbInsert("post_results", resultSeeds).catch(() => {});

    let results = resultSeeds;
    if (!isScheduled) {
      results = await publishNow({ ...post, media_url: mediaUrl }, connMap);
      // Re-read updated post status
      const updated = await sbOne("posts", { "id": `eq.${post.id}` });
      if (updated) post.status = updated.status;
    }

    await addEvent(user.id, isScheduled ? "schedule" : "post",
      isScheduled ? `Post scheduled for ${new Date(sched).toLocaleString()}` : `Post created: ${results.filter(r => r.ok).length}/${platforms.length} platforms`,
      { postId: post.id }
    );
    const analytics = await getUserAnalytics(user.id);
    return sendJson(res, 200, { post: { ...publicPost({ ...post, post_results: results.map(r => ({ provider_id: r.providerId, platform: r.platform, ok: r.ok, status: r.status, message: r.message, external_id: r.externalId })) }), results }, analytics });
  }

  // ── Get posts ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/posts") {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    return sendJson(res, 200, { posts: await getUserPosts(user.id) });
  }

  // ── Edit post ──────────────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname.match(/^\/api\/posts\/[^/]+$/) && !url.pathname.endsWith("/publish")) {
    const user   = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const postId  = url.pathname.split("/").pop();
    const payload = jsonBody(await readBody(req));
    const text    = String(payload.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "Post text is required" });
    await sbUpdate("posts", { "id": `eq.${postId}`, "user_id": `eq.${user.id}` }, {
      text,
      media_url:     String(payload.mediaUrl || "").trim() || null,
      schedule_date: payload.scheduleDate ? new Date(payload.scheduleDate).toISOString() : null,
      campaign:      String(payload.campaign || "General"),
      updated_at:    new Date().toISOString()
    });
    const post = await sbOne("posts", { "id": `eq.${postId}`, "user_id": `eq.${user.id}` }, "*,post_results(*)");
    return sendJson(res, 200, { post: post ? publicPost(post) : null, analytics: await getUserAnalytics(user.id) });
  }

  // ── Publish scheduled post now ─────────────────────────────────────────────
  if (req.method === "POST" && url.pathname.match(/^\/api\/posts\/[^/]+\/publish$/)) {
    const user   = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const postId = url.pathname.split("/").slice(-2)[0];
    const post   = await sbOne("posts", { "id": `eq.${postId}`, "user_id": `eq.${user.id}` });
    if (!post) return sendJson(res, 404, { error: "Post not found" });
    const conns   = await sbSelect("connections", { "user_id": `eq.${user.id}` }).catch(() => []);
    const connMap = Object.fromEntries((conns || []).map(c => [c.provider_id, c]));
    const results = await publishNow(post, connMap);
    await addEvent(user.id, "post", `Scheduled post published now`, { postId });
    const updated = await sbOne("posts", { "id": `eq.${postId}` }, "*,post_results(*)");
    return sendJson(res, 200, { post: updated ? publicPost(updated) : null, analytics: await getUserAnalytics(user.id) });
  }

  // ── Automations ────────────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname.match(/^\/api\/automations\/.+$/)) {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const automationId = url.pathname.split("/").pop();
    const { enabled }  = jsonBody(await readBody(req));
    await sbUpdate("automations", { "id": `eq.${automationId}`, "user_id": `eq.${user.id}` }, { enabled: Boolean(enabled), updated_at: new Date().toISOString() }).catch(() => {});
    return sendJson(res, 200, { ok: true });
  }

  // ── Developer: regenerate API key ──────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/profile/regenerate-key") {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const newKey = `pp_${crypto.randomBytes(18).toString("hex")}`;
    await addEvent(user.id, "developer", "API key regenerated");
    return sendJson(res, 200, { profile: { name: "Postvora Studio", plan: user.plan || "free", apiKey: newKey } });
  }

  // ── Admin summary ──────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/admin/summary") {
    const user = await getSessionUser(req);
    if (!user || !isAdmin(user)) return sendJson(res, 403, { error: "Admin access required. Set ADMIN_EMAIL in .env" });
    const [users, posts, conns, events] = await Promise.all([
      sbSelect("app_users", {},  { order: "created_at.desc", limit: 100 }).catch(() => []),
      sbSelect("posts",     {},  { select: "status", limit: 500 }).catch(() => []),
      sbSelect("connections", {}, { select: "provider_id", limit: 500 }).catch(() => []),
      sbSelect("events",    {},  { order: "created_at.desc", limit: 20 }).catch(() => [])
    ]);
    return sendJson(res, 200, {
      users: { total: users?.length || 0, google: (users || []).filter(u => u.provider === "google").length, email: (users || []).filter(u => u.provider === "email").length },
      billing: { source: "Stripe not connected", mrr: null },
      usage: { posts: posts?.length || 0, published: (posts || []).filter(p => p.status === "published").length, scheduled: (posts || []).filter(p => p.status === "scheduled").length },
      platforms: { connections: conns?.length || 0 },
      recentUsers: (users || []).slice(0, 8).map(u => ({ id: u.id, name: u.name, email: u.email, provider: u.provider })),
      audit: events || []
    });
  }

  sendJson(res, 404, { error: "Not found" });
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC FILE SERVER
// ─────────────────────────────────────────────────────────────────────────────
function serveStatic(req, res, url) {
  if (url.pathname.startsWith("/uploads/")) {
    const name = decodeURIComponent(url.pathname.replace(/^\/uploads\//, ""));
    const fp   = path.normalize(path.join(UPLOAD_DIR, name));
    if (!fp.startsWith(UPLOAD_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
    return fs.readFile(fp, (err, content) => {
      if (err) { res.writeHead(404); return res.end("Not found"); }
      const ct = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" }[path.extname(fp).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "content-type": ct, "cache-control": "public, max-age=31536000, immutable" });
      res.end(content);
    });
  }
  const reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const fp = path.normalize(path.join(PUBLIC_DIR, reqPath));
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(fp, (err, content) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ct = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" }[path.extname(fp)] || "application/octet-stream";
    res.writeHead(200, { "content-type": ct });
    res.end(content);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN REQUEST HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function appHandler(req, res) {
  try {
    const url = new URL(req.url, APP_URL);

    if (req.method === "GET" && url.pathname === "/healthz") return sendJson(res, 200, { ok: true, app: "Postvora" });

    // Google auth callback
    if (req.method === "GET" && url.pathname === "/auth/callback/google") {
      const code  = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) return redirect(res, `/?oauth_error=${encodeURIComponent(error)}`);
      if (!code || !state) return redirect(res, "/?oauth_error=Invalid%20callback");
      try {
        const { sessionId } = await completeGoogleLogin(code, state);
        res.writeHead(302, { location: "/?login=google", "set-cookie": sessionCookie(sessionId) });
        return res.end();
      } catch (err) { return redirect(res, `/?oauth_error=${encodeURIComponent(err.message)}`); }
    }

    // Social platform OAuth callback
    if (req.method === "GET" && url.pathname.startsWith("/oauth/callback/")) {
      const pid   = url.pathname.split("/").pop();
      const code  = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) return redirect(res, `/?oauth_error=${encodeURIComponent(error)}#accounts`);
      if (!PROVIDERS[pid] || !code || !state) return redirect(res, "/?oauth_error=Invalid%20callback#accounts");
      try {
        await completeOAuthConnection(pid, code, state);
        return redirect(res, "/?connected=1#accounts");
      } catch (err) { return redirect(res, `/?oauth_error=${encodeURIComponent(err.message)}#accounts`); }
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, res, url).catch(err => {
        console.error("[API]", req.method, url.pathname, err.message);
        sendJson(res, 500, { error: err.message || "Internal server error" });
      });
    }

    serveStatic(req, res, url);
  } catch (err) {
    console.error("[App]", err.message);
    sendJson(res, 500, { error: err.message || "Server error" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!SB_URL || !SB_KEY) console.warn("[WARN] SUPABASE_URL / SUPABASE_SECRET_KEY not set — auth disabled");

  http.createServer(appHandler).listen(PORT, () => {
    console.log(`\n  ✦  Postvora running → ${APP_URL}\n`);
    startScheduler();
  });
}

module.exports = appHandler;
