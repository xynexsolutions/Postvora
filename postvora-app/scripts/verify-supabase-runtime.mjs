import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
loadEnvFile(path.join(root, ".env"));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("Add SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.");
}

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

async function supabase(pathname) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "content-type": "application/json"
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${pathname} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

const [users, posts, events, snapshot] = await Promise.all([
  supabase("app_users?select=id"),
  supabase("posts?select=id"),
  supabase("events?select=id"),
  supabase("admin_settings?key=eq.app_snapshot&select=key,updated_at")
]);

console.log(JSON.stringify({
  ok: true,
  tables: {
    app_users: users.length,
    posts: posts.length,
    events: events.length
  },
  runtimeSnapshot: snapshot[0] || null
}, null, 2));
