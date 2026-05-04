import { createCodeChallenge, createRandomToken, encodeMimeHeader, stringToBase64Url } from './encoding.ts'
import { getGmailOAuthRedirectUri, getRequiredEnv } from './env.ts'

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export async function createGoogleAuthUrl(state: string, codeVerifier: string) {
  const codeChallenge = await createCodeChallenge(codeVerifier)
  const authUrl = new URL(GOOGLE_AUTH_URL)

  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('client_id', getRequiredEnv('GOOGLE_OAUTH_CLIENT_ID'))
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('include_granted_scopes', 'true')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('redirect_uri', getGmailOAuthRedirectUri())
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', `openid email ${GMAIL_SEND_SCOPE}`)
  authUrl.searchParams.set('state', state)

  return authUrl.toString()
}

export function createOAuthState() {
  return createRandomToken(32)
}

export function createOAuthCodeVerifier() {
  return createRandomToken(64)
}

export async function exchangeCodeForTokens(code: string, codeVerifier: string) {
  const body = new URLSearchParams({
    client_id: getRequiredEnv('GOOGLE_OAUTH_CLIENT_ID'),
    client_secret: getRequiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: getGmailOAuthRedirectUri(),
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error_description ?? data.error ?? 'Google token exchange failed.')
  }

  return data as {
    access_token: string
    expires_in: number
    refresh_token?: string
    scope?: string
  }
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: getRequiredEnv('GOOGLE_OAUTH_CLIENT_ID'),
    client_secret: getRequiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error_description ?? data.error ?? 'Unable to refresh Gmail access.')
  }

  return data as {
    access_token: string
    expires_in: number
    scope?: string
  }
}

export async function getGoogleUserInfo(accessToken: string) {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error_description ?? data.error ?? 'Unable to read connected Gmail profile.')
  }

  return data as {
    email: string
    sub: string
  }
}

export async function revokeGoogleToken(refreshToken: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: 'POST',
  })
}

export function createRawEmailMessage(input: {
  body: string
  from: string
  subject: string
  to: string
}) {
  const message = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.body,
  ].join('\r\n')

  return stringToBase64Url(message)
}

export async function sendGmailMessage(accessToken: string, raw: string) {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    body: JSON.stringify({ raw }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error?.message ?? 'Gmail API send failed.')
  }

  return data as {
    id: string
    threadId: string
  }
}
