import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const EXPECTED_SUPABASE_PROJECT_REF = 'eaocwrgbqeakyycmtbah'
const EXPECTED_SUPABASE_URL = `https://${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co`
const ACCEPTED_ANON_KEY_HASHES = new Set([
  '95301175e436f311b3306ec1e34bbcd489878a48d455ec1127c408688d5489dc',
  '42b5aa17d4e0ca3636be1cc035124834a9ebfd673a73f1e233b76357887df50f',
])

const envFileOrder = ['.env', '.env.local', '.env.production', '.env.production.local']
const env = { ...process.env }

function parseEnvLine(line) {
  const trimmed = line.trim()

  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
    return null
  }

  const separatorIndex = trimmed.indexOf('=')
  const key = trimmed.slice(0, separatorIndex).trim()
  let value = trimmed.slice(separatorIndex + 1).trim()

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  return [key, value]
}

for (const filename of envFileOrder) {
  const filepath = resolve(process.cwd(), filename)

  if (!existsSync(filepath)) {
    continue
  }

  const lines = readFileSync(filepath, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const parsed = parseEnvLine(line)

    if (!parsed) {
      continue
    }

    const [key, value] = parsed
    env[key] = env[key] ?? value
  }
}

function fail(message) {
  console.error(`\nAuth config lock failed: ${message}\n`)
  process.exit(1)
}

function normalizeSupabaseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)

    if (url.pathname !== '/' && url.pathname !== '') {
      fail(
        `VITE_SUPABASE_URL must be the project root, not "${url.pathname}". Use ${EXPECTED_SUPABASE_URL}`,
      )
    }

    return url.origin
  } catch {
    fail('VITE_SUPABASE_URL must be a valid URL.')
  }
}

const supabaseUrl = env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim()

if (!supabaseUrl) {
  fail('Missing VITE_SUPABASE_URL.')
}

if (!supabaseAnonKey) {
  fail('Missing VITE_SUPABASE_ANON_KEY.')
}

const normalizedSupabaseUrl = normalizeSupabaseUrl(supabaseUrl)

if (normalizedSupabaseUrl !== EXPECTED_SUPABASE_URL) {
  fail(`VITE_SUPABASE_URL changed. Expected ${EXPECTED_SUPABASE_URL}`)
}

if (supabaseAnonKey.startsWith('sb_secret_')) {
  fail('VITE_SUPABASE_ANON_KEY is using a secret key. Use the publishable or anon public key only.')
}

if (supabaseAnonKey.startsWith('{') || supabaseAnonKey.includes('client_secret')) {
  fail('VITE_SUPABASE_ANON_KEY looks like pasted Google OAuth JSON. Use the Supabase anon/publishable key.')
}

if (supabaseAnonKey.startsWith('GOCSPX-')) {
  fail('VITE_SUPABASE_ANON_KEY looks like a Google client secret. Never put that in the frontend.')
}

const anonKeyHash = createHash('sha256').update(supabaseAnonKey).digest('hex')

if (!ACCEPTED_ANON_KEY_HASHES.has(anonKeyHash)) {
  fail('VITE_SUPABASE_ANON_KEY changed from the locked working key. Rotate intentionally only.')
}

console.log('Auth config lock passed.')
