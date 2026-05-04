import { corsHeaders } from './cors.ts'

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

export function redirectResponse(url: string) {
  return new Response(null, {
    headers: {
      Location: url,
    },
    status: 302,
  })
}

export function handleOptions(req: Request) {
  if (req.method !== 'OPTIONS') {
    return null
  }

  return new Response('ok', {
    headers: corsHeaders,
  })
}

export function redirectWithError(redirectTo: string, message: string) {
  const url = new URL(redirectTo)
  url.searchParams.set('gmail_error', message)
  return redirectResponse(url.toString())
}
