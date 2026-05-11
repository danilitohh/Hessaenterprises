declare const process: {
  env: Record<string, string | undefined>
}

const LOCKED_SUPABASE_URL = 'https://eaocwrgbqeakyycmtbah.supabase.co'

export const config = {
  runtime: 'edge',
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

function getSupabaseUrl() {
  return (
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    LOCKED_SUPABASE_URL
  ).replace(/\/$/, '')
}

function getMaxPerRun() {
  const value = Number(process.env.GMAIL_CRON_MAX_PER_RUN ?? 25)

  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.trunc(value))) : 25
}

export default async function handler(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret) {
    return jsonResponse({ error: 'CRON_SECRET is required.' }, { status: 500 })
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  if (request.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
  }

  const response = await fetch(`${getSupabaseUrl()}/functions/v1/gmail-process-followups`, {
    body: JSON.stringify({
      maxPerRun: getMaxPerRun(),
    }),
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
  const responseBody = await response.text()

  return new Response(responseBody, {
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
    },
    status: response.status,
  })
}
