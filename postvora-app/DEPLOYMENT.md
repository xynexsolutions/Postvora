# Postvora Deployment Guide

## Recommended Production Path

Use **Vercel + Supabase** for the long-term SaaS version.

- Vercel hosts the app and API routes.
- Supabase stores production app data.
- OAuth providers must use the final Vercel domain in their callback URLs.
- Media uploads currently write to the app filesystem. For serious production uploads, move media to Cloudflare R2 or another object storage provider before public launch.

Railway is still a good fallback for a classic long-running Node server, but the current repo now includes a Vercel serverless adapter.

## Required Vercel Environment Variables

Add these in **Vercel Project > Settings > Environment Variables**.

```env
NODE_ENV=production
APP_URL=https://your-vercel-domain.vercel.app
APP_SECRET=generate-a-long-random-secret
ADMIN_EMAIL=your-admin@gmail.com

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-supabase-secret-or-service-role-key

GOOGLE_AUTH_CLIENT_ID=
GOOGLE_AUTH_CLIENT_SECRET=

META_CLIENT_ID=
META_CLIENT_SECRET=

INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=

LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

TIKTOK_CLIENT_ID=
TIKTOK_CLIENT_SECRET=

PINTEREST_CLIENT_ID=
PINTEREST_CLIENT_SECRET=

THREADS_CLIENT_ID=
THREADS_CLIENT_SECRET=
```

Do not add real secrets to GitHub.

## Vercel Deploy Steps

1. Push this folder to GitHub.
2. Open Vercel.
3. Click **Add New > Project**.
4. Import the GitHub repo.
5. Framework preset: **Other**.
6. Build command: leave empty or use `npm install`.
7. Output directory: leave empty.
8. Add all environment variables above.
9. Deploy.
10. Open `https://your-vercel-domain.vercel.app/healthz`.
11. It should return:

```json
{"ok":true,"app":"Postvora"}
```

## Supabase Checks

Run these locally after adding `.env` values:

```bash
node scripts/migrate-local-db-to-supabase.mjs
node scripts/verify-supabase-runtime.mjs
```

If PowerShell blocks `npm`, use the direct `node ...` commands above.

## OAuth Callback URLs

Replace `https://your-vercel-domain.vercel.app` with your final domain.

```text
Google app login:
https://your-vercel-domain.vercel.app/auth/callback/google

Facebook:
https://your-vercel-domain.vercel.app/oauth/callback/facebook

Instagram:
https://your-vercel-domain.vercel.app/oauth/callback/instagram

LinkedIn:
https://your-vercel-domain.vercel.app/oauth/callback/linkedin

YouTube:
https://your-vercel-domain.vercel.app/oauth/callback/youtube

TikTok:
https://your-vercel-domain.vercel.app/oauth/callback/tiktok

Pinterest:
https://your-vercel-domain.vercel.app/oauth/callback/pinterest

Threads:
https://your-vercel-domain.vercel.app/oauth/callback/threads
```

## Launch Notes

- Use a custom domain before app review if possible.
- Set `APP_URL` to the exact live domain, with no trailing slash.
- Reconnect social accounts after switching from localhost to the live domain.
- Keep `ADMIN_EMAIL` set to your own Google login email so only you can access the admin panel.
- Add Cloudflare R2 before paid launch if users will upload lots of media.
