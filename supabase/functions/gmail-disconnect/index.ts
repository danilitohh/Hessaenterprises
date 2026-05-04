import { decryptToken } from '../_shared/crypto.ts'
import { revokeGoogleToken } from '../_shared/google.ts'
import { handleOptions, jsonResponse } from '../_shared/http.ts'
import { createAdminClient, getAuthenticatedUser } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)

  if (optionsResponse) {
    return optionsResponse
  }

  try {
    const user = await getAuthenticatedUser(req)
    const supabase = createAdminClient()
    const { data: connection, error: connectionError } = await supabase
      .from('gmail_connections')
      .select('id,encrypted_refresh_token')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .maybeSingle()

    if (connectionError) {
      throw new Error(connectionError.message)
    }

    if (connection?.encrypted_refresh_token) {
      try {
        const refreshToken = await decryptToken(connection.encrypted_refresh_token)
        await revokeGoogleToken(refreshToken)
      } catch {
        // Still disconnect locally if Google revoke is unavailable.
      }
    }

    const { error } = await supabase
      .from('gmail_connections')
      .update({
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    if (error) {
      throw new Error(error.message)
    }

    return jsonResponse({ disconnected: true })
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Unable to disconnect Gmail.',
      },
      { status: 400 },
    )
  }
})
