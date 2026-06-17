# Postvora Setup

Postvora is a branded social media automation app with a premium dashboard, account linking center, campaign composer, scheduling queue, automation rules, analytics summary, and developer API surface.

## Run Locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Real Account Linking

The app now uses a real OAuth-first flow. If OAuth credentials are missing, the dashboard will not create a fake connection. When credentials are configured, the Connect toggle redirects the user to the official platform login/consent screen. After login, the callback exchanges the authorization code for tokens and stores the token payload encrypted.

## Live Social Posting

To enable real account sign-in and posting, create developer apps for each platform and fill `.env` values:

```env
META_CLIENT_ID=
META_CLIENT_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
X_CLIENT_ID=
X_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
TIKTOK_CLIENT_ID=
TIKTOK_CLIENT_SECRET=
PINTEREST_CLIENT_ID=
PINTEREST_CLIENT_SECRET=
THREADS_CLIENT_ID=
THREADS_CLIENT_SECRET=
```

Also set a strong encryption secret:

```env
APP_SECRET=replace-with-a-long-random-secret
```

Use this callback pattern in platform developer dashboards:

```text
http://localhost:3000/oauth/callback/{provider}
```

For production, replace localhost with your real domain.

## Required Platform Setup

- Meta app: Facebook Pages + Instagram Graph permissions, valid OAuth redirect URI, app review for posting permissions.
- LinkedIn app: Sign In with LinkedIn + `w_member_social` or organization posting permissions where applicable.
- Google Cloud app: YouTube Data API enabled, OAuth consent screen published, YouTube upload scope approved.
- X developer app: OAuth 2.0 enabled, callback URL added, write scopes enabled.
- TikTok developer app: Login Kit/content posting permissions approved.
- Pinterest developer app: OAuth app configured with pin/board scopes.
- Threads app: Threads API permissions and callback URL configured.

## Production Notes

- Store tokens encrypted in a real database.
- Move from JSON storage to PostgreSQL before launch.
- Use Redis/BullMQ or a hosted queue for scheduled publishing workers.
- Complete platform app reviews for Meta, LinkedIn, Google/YouTube, TikTok, X, Pinterest, and Threads.
- Add billing, team permissions, audit logs, and rate-limit protection before selling access.
