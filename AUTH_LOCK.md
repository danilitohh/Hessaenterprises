# Auth Config Lock

This project has a working Supabase Auth setup for:

- Email registration
- Email/password login
- Forgot password email delivery
- Reset password page
- Google OAuth login

## Do not change casually

These values are locked because changing one of them can break login, registration, password reset, or Google OAuth:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- Supabase `Authentication > URL Configuration`
- Supabase `Authentication > Sign In / Providers > Google`
- Google Cloud OAuth `Authorized redirect URIs`
- Google Cloud OAuth `Authorized JavaScript origins`

## Current locked Supabase project

```text
Project ref: eaocwrgbqeakyycmtbah
Project URL: https://eaocwrgbqeakyycmtbah.supabase.co
```

The frontend env var must be:

```text
VITE_SUPABASE_URL=https://eaocwrgbqeakyycmtbah.supabase.co
```

Do not add `/rest/v1/` to `VITE_SUPABASE_URL`.

## Required redirect settings

Supabase `Authentication > URL Configuration`:

```text
Site URL:
https://hessaenterprises.vercel.app

Redirect URLs:
https://hessaenterprises.vercel.app
https://hessaenterprises.vercel.app/**
```

Google Cloud OAuth Web Client:

```text
Authorized JavaScript origins:
https://hessaenterprises.vercel.app

Authorized redirect URIs:
https://eaocwrgbqeakyycmtbah.supabase.co/auth/v1/callback
```

## Secret handling

Never put the Google OAuth client secret in frontend code, `.env.example`, screenshots, commits, or public docs.

The Google OAuth client secret belongs only in:

```text
Supabase > Authentication > Sign In / Providers > Google > Client Secret
```

The frontend must only use the Supabase publishable/anon public key:

```text
VITE_SUPABASE_ANON_KEY=...
```

## Build guard

The build runs:

```bash
npm run check:auth-config
```

That script fails the build if:

- `VITE_SUPABASE_URL` points to another Supabase project.
- `VITE_SUPABASE_URL` includes `/rest/v1/`.
- `VITE_SUPABASE_ANON_KEY` is missing.
- A secret key or Google OAuth secret is pasted into `VITE_SUPABASE_ANON_KEY`.
- The anon/publishable key changes from the known working key.

## Intentional changes

If we intentionally migrate Supabase projects or rotate the frontend anon/publishable key:

1. Confirm login, register, forgot password, reset password, and Google OAuth in Vercel.
2. Update Vercel environment variables.
3. Update Supabase URL configuration.
4. Update Google Cloud OAuth redirect settings if the Supabase project changed.
5. Update `scripts/check-auth-config.mjs` with the new expected project ref and key hash.
6. Run `npm run lint` and `npm run build`.
