# OAuth Setup Guide: Facebook, LinkedIn, Instagram

This guide explains how to create platform developer credentials for Postvora.

Users do not add these credentials. Only the app owner adds them once in `.env`.

## Local Callback URLs

Add these redirect/callback URLs in each developer portal while testing locally:

```text
http://localhost:3000/oauth/callback/facebook
http://localhost:3000/oauth/callback/linkedin
http://localhost:3000/oauth/callback/instagram
```

For production, replace `http://localhost:3000` with your deployed domain.

## .env Location

Create this file:

```text
C:\Users\User\Documents\Social Media Automation\.env
```

Use `.env.example` as the template.

## Facebook Setup

1. Go to Meta for Developers:

```text
https://developers.facebook.com/apps/
```

2. Click Create App.
3. Choose a business/company app type or use case that supports Facebook Login and Graph API access.
4. Enter app name, contact email, and connect/select your Business Manager if requested.
5. Open the app dashboard.
6. Go to App Settings > Basic.
7. Copy:

```env
META_CLIENT_ID=your_meta_app_id
META_CLIENT_SECRET=your_meta_app_secret
```

8. Add the Facebook Login product/use case.
9. In Facebook Login settings, add this Valid OAuth Redirect URI:

```text
http://localhost:3000/oauth/callback/facebook
```

10. For Facebook Page posting, request/add these permissions:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
```

11. While the app is in development mode, only app admins, developers, and testers can connect.
12. For real public users, submit Meta App Review for the required permissions.

## LinkedIn Setup

1. Go to LinkedIn Developers:

```text
https://www.linkedin.com/developers/apps
```

2. Click Create App.
3. Enter app name, LinkedIn Page/company, privacy policy URL, logo, and contact details.
4. Verify company/page ownership if LinkedIn asks.
5. Open your app.
6. Go to the Auth tab.
7. Copy:

```env
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
```

8. Add this Authorized Redirect URL:

```text
http://localhost:3000/oauth/callback/linkedin
```

9. Go to the Products tab.
10. Add the products/scopes needed for your use case:

```text
Sign In with LinkedIn using OpenID Connect
Share on LinkedIn
```

11. Required scopes for current app flow:

```text
openid
profile
w_member_social
```

12. Save changes.

## Instagram Setup

Instagram can be connected with Instagram Login for Business/Creator accounts.

1. Use your Meta developer app and add/configure the Instagram API / Instagram Login product or use case.
2. Make sure the Instagram account is Professional:

```text
Business or Creator account
```

3. For best publishing support, connect that Instagram account to a Facebook Page in Meta Accounts Center / Business Suite.
4. In Meta app dashboard, open the Instagram product/API setup.
5. Copy the Instagram client ID and secret if Meta shows separate Instagram credentials:

```env
INSTAGRAM_CLIENT_ID=your_instagram_client_id
INSTAGRAM_CLIENT_SECRET=your_instagram_client_secret
```

If your app uses the same Meta app credentials for Instagram Login, these can match your Meta app ID/secret.

6. Add this Valid OAuth Redirect URI:

```text
http://localhost:3000/oauth/callback/instagram
```

7. Add/request these permissions for Instagram Login:

```text
instagram_business_basic
instagram_business_content_publish
```

8. Add these to `.env`:

```env
INSTAGRAM_CLIENT_ID=your_instagram_client_id
INSTAGRAM_CLIENT_SECRET=your_instagram_client_secret
```

9. In development mode, only app admins/developers/testers can connect.
10. For real customer accounts, submit Meta App Review / permission review for Instagram permissions.

## Final .env Example

```env
PORT=3000
APP_URL=http://localhost:3000
APP_SECRET=replace-with-a-long-random-secret

META_CLIENT_ID=your_meta_app_id
META_CLIENT_SECRET=your_meta_app_secret

INSTAGRAM_CLIENT_ID=your_instagram_client_id
INSTAGRAM_CLIENT_SECRET=your_instagram_client_secret

LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
```

Restart the server after editing `.env`.

```bash
npm start
```

## Important Production Notes

- Facebook and Instagram public use requires Meta App Review.
- Facebook Page publishing requires a Page access token, not only a user token.
- Instagram publishing requires the Instagram Business Account ID connected to a Facebook Page.
- LinkedIn organization posting may require organization permissions beyond member posting.
- Client secrets must never be exposed in frontend JavaScript.
