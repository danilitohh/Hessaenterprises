# Gmail Sending Integration

This integration lets each signed-in user connect Gmail once and send follow-up emails from their own Gmail account.

The frontend never stores Google secrets or refresh tokens. Tokens are handled only inside Supabase Edge Functions and stored encrypted in Postgres.

## What Was Added

- `Connect Gmail` / `Disconnect` UI inside the logged-in dashboard settings.
- Gmail connection status via Supabase Edge Functions.
- Optional automatic sending in the existing follow-up buttons.
- Safe fallback to the current `mailto:` draft flow when Gmail is not connected or functions are not deployed.
- Supabase SQL migration for Gmail connections, OAuth state, and send logs.
- Supabase Edge Functions:
  - `gmail-oauth-start`
  - `gmail-oauth-callback`
  - `gmail-status`
  - `gmail-disconnect`
  - `gmail-send-followup`

## Google Cloud Setup

1. Go to Google Cloud Console.
2. Enable the Gmail API for the project.
3. Configure OAuth consent screen.
4. Add the Gmail send scope:

```text
https://www.googleapis.com/auth/gmail.send
```

5. In the OAuth Web Client, add this Authorized redirect URI:

```text
https://eaocwrgbqeakyycmtbah.supabase.co/functions/v1/gmail-oauth-callback
```

6. Keep this existing JavaScript origin:

```text
https://hessaenterprises.vercel.app
```

## Supabase Setup

Link the local repo to Supabase if needed:

```bash
supabase link --project-ref eaocwrgbqeakyycmtbah
```

Apply the database migration:

```bash
supabase db push
```

Set Edge Function secrets:

```bash
supabase secrets set \
  GOOGLE_OAUTH_CLIENT_ID="your-google-client-id.apps.googleusercontent.com" \
  GOOGLE_OAUTH_CLIENT_SECRET="your-google-client-secret" \
  GMAIL_TOKEN_ENCRYPTION_KEY="generate-a-long-random-secret" \
  APP_ORIGIN="https://hessaenterprises.vercel.app"
```

If your Supabase project uses the new `sb_secret_...` key system, also set:

```bash
supabase secrets set \
  SUPABASE_PUBLISHABLE_KEY="your-supabase-publishable-key" \
  SUPABASE_SECRET_KEY="your-supabase-sb-secret-key"
```

If your project still shows the legacy anon/service role keys, Supabase may provide `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically. The functions support either naming style.

Recommended encryption key generation:

```bash
openssl rand -base64 32
```

Deploy the functions:

```bash
supabase functions deploy gmail-oauth-start
supabase functions deploy gmail-oauth-callback
supabase functions deploy gmail-status
supabase functions deploy gmail-disconnect
supabase functions deploy gmail-send-followup
```

The callback function has `verify_jwt = false` in `supabase/config.toml` because Google redirects to it without a Supabase session header. It still validates the signed-in user through the stored OAuth `state`.

## How The User Flow Works

1. User logs into Hessa.
2. User clicks `Connect Gmail`.
3. User grants Gmail send permission in Google.
4. Google returns to `gmail-oauth-callback`.
5. The Edge Function stores the encrypted refresh token.
6. The dashboard shows the connected Gmail account.
7. Existing follow-up buttons try Gmail API first.
8. If Gmail is not connected, the app still opens the existing browser email draft.

## Important Notes

- Users must consent once. Google does not allow silent Gmail connection without user approval.
- Do not use app passwords for SaaS users.
- Do not store Google refresh tokens in localStorage or frontend code.
- `gmail.send` is the narrow Gmail scope needed for sending messages.
- Public apps that use Gmail scopes may require Google OAuth verification.
