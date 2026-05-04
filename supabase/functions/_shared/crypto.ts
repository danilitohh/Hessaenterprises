import { base64UrlToBytes, bytesToBase64Url } from './encoding.ts'
import { getRequiredEnv } from './env.ts'

async function getTokenEncryptionKey() {
  const secret = getRequiredEnv('GMAIL_TOKEN_ENCRYPTION_KEY')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))

  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt', 'encrypt'])
}

export async function encryptToken(token: string) {
  const key = await getTokenEncryptionKey()
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)

  const encrypted = await crypto.subtle.encrypt(
    {
      iv,
      name: 'AES-GCM',
    },
    key,
    new TextEncoder().encode(token),
  )

  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`
}

export async function decryptToken(encryptedToken: string) {
  const [encodedIv, encodedCiphertext] = encryptedToken.split('.')

  if (!encodedIv || !encodedCiphertext) {
    throw new Error('Stored Gmail token is invalid.')
  }

  const key = await getTokenEncryptionKey()
  const decrypted = await crypto.subtle.decrypt(
    {
      iv: base64UrlToBytes(encodedIv),
      name: 'AES-GCM',
    },
    key,
    base64UrlToBytes(encodedCiphertext),
  )

  return new TextDecoder().decode(decrypted)
}
