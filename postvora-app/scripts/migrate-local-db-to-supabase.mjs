import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
loadEnvFile(path.join(root, ".env"));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_FILE = path.join(root, "data", "db.json");

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("Add SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.");
}

if (!fs.existsSync(DB_FILE)) {
  throw new Error("Local data/db.json was not found.");
}

const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function supabase(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation,resolution=merge-duplicates",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${pathname} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function localUserToRow(user) {
  const provider = user.provider || (String(user.id || "").includes(":") ? String(user.id).split(":")[0] : "google");
  const providerUserId = String(user.id || user.email || crypto.randomUUID()).replace(/^[^:]+:/, "");
  return {
    provider,
    provider_user_id: providerUserId,
    email: user.email,
    name: user.name || user.email,
    picture_url: user.picture || null,
    plan: user.plan || "free",
    subscription_status: user.subscriptionStatus || "none",
    last_login_at: iso(user.signedInAt),
    created_at: iso(user.createdAt) || new Date().toISOString()
  };
}

async function migrateUsers() {
  const usersByEmail = new Map();
  for (const user of Object.values(db.users || {})) {
    if (!user.email) continue;
    usersByEmail.set(String(user.email).toLowerCase(), user);
  }
  const users = [...usersByEmail.values()];
  if (!users.length) return new Map();
  const rows = users.map(localUserToRow);
  const saved = await supabase("app_users?on_conflict=email", {
    method: "POST",
    body: JSON.stringify(rows)
  });
  return new Map(saved.map(user => [user.email, user.id]));
}

async function migrateConnections() {
  const rows = Object.entries(db.connections || {}).map(([providerId, connection]) => {
    const {
      token,
      providerId: ignoredProviderId,
      ...providerData
    } = connection;
    return {
      user_id: null,
      provider_id: providerId,
      mode: connection.mode || "oauth",
      account_name: connection.accountName || null,
      connected_at: iso(connection.connectedAt) || new Date().toISOString(),
      token_encrypted: token || {},
      provider_data: providerData || {}
    };
  });
  if (!rows.length) return 0;
  await supabase("connections?on_conflict=provider_id,user_id", {
    method: "POST",
    body: JSON.stringify(rows),
    headers: { prefer: "return=minimal,resolution=merge-duplicates" }
  });
  return rows.length;
}

async function migratePosts() {
  let postCount = 0;
  let resultCount = 0;
  for (const post of db.posts || []) {
    const [savedPost] = await supabase("posts", {
      method: "POST",
      body: JSON.stringify({
        id: post.id,
        user_id: null,
        text: post.text,
        media_url: post.mediaUrl || null,
        campaign: post.campaign || "General",
        platforms: Array.isArray(post.platforms) ? post.platforms : [],
        status: post.status || "ready",
        schedule_date: iso(post.scheduleDate),
        published_at: iso(post.publishedAt),
        insights: post.insights || null,
        created_at: iso(post.createdAt) || new Date().toISOString(),
        updated_at: iso(post.updatedAt) || iso(post.createdAt) || new Date().toISOString()
      })
    });
    postCount += 1;

    const results = (post.results || []).map(result => ({
      post_id: savedPost.id,
      provider_id: result.providerId || result.provider_id,
      platform: result.platform || result.providerId || "Platform",
      ok: Boolean(result.ok),
      status: result.status || "queued",
      mode: result.mode || null,
      message: result.message || null,
      external_id: result.externalId || null,
      raw_response: result
    }));
    if (results.length) {
      await supabase("post_results", {
        method: "POST",
        body: JSON.stringify(results),
        headers: { prefer: "return=minimal" }
      });
      resultCount += results.length;
    }
  }
  return { postCount, resultCount };
}

async function migrateEvents() {
  const rows = (db.events || []).map(event => ({
    user_id: null,
    type: event.type || "event",
    message: event.message || "",
    details: event.details || {},
    created_at: iso(event.createdAt) || new Date().toISOString()
  }));
  if (!rows.length) return 0;
  await supabase("events", {
    method: "POST",
    body: JSON.stringify(rows),
    headers: { prefer: "return=minimal" }
  });
  return rows.length;
}

async function migrateAutomations() {
  const rows = (db.automations || []).map(rule => ({
    user_id: null,
    name: rule.name,
    trigger_text: rule.trigger || rule.trigger_text,
    action_text: rule.action || rule.action_text,
    enabled: Boolean(rule.enabled),
    created_at: iso(rule.createdAt) || new Date().toISOString(),
    updated_at: iso(rule.updatedAt) || new Date().toISOString()
  })).filter(rule => rule.name && rule.trigger_text && rule.action_text);
  if (!rows.length) return 0;
  await supabase("automations", {
    method: "POST",
    body: JSON.stringify(rows),
    headers: { prefer: "return=minimal" }
  });
  return rows.length;
}

const userMap = await migrateUsers();
const connections = await migrateConnections();
const posts = await migratePosts();
const events = await migrateEvents();
const automations = await migrateAutomations();

console.log(JSON.stringify({
  ok: true,
  users: userMap.size,
  connections,
  posts: posts.postCount,
  postResults: posts.resultCount,
  events,
  automations
}, null, 2));
