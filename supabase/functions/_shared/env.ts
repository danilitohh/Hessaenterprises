export function getRequiredEnv(name: string) {
  const value = Deno.env.get(name)

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

export function getAppOrigins() {
  const primaryOrigin = Deno.env.get('APP_ORIGIN') ?? 'https://hessaenterprises.vercel.app'
  const additionalOrigins = (Deno.env.get('ADDITIONAL_APP_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return new Set([primaryOrigin, 'http://localhost:5173', ...additionalOrigins])
}

export function assertAllowedRedirect(redirectTo: string) {
  const url = new URL(redirectTo)
  const allowedOrigins = getAppOrigins()

  if (!allowedOrigins.has(url.origin)) {
    throw new Error(`Redirect origin is not allowed: ${url.origin}`)
  }

  return url.toString()
}

export function getGmailOAuthRedirectUri() {
  return (
    Deno.env.get('GMAIL_OAUTH_REDIRECT_URI') ??
    `${getRequiredEnv('SUPABASE_URL')}/functions/v1/gmail-oauth-callback`
  )
}
