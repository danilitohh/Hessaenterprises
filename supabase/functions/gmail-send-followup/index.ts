import { decryptToken } from '../_shared/crypto.ts'
import {
  createRawEmailMessage,
  isGoogleRefreshTokenInvalidError,
  refreshGoogleAccessToken,
  sendGmailMessage,
} from '../_shared/google.ts'
import { handleOptions, jsonResponse } from '../_shared/http.ts'
import {
  createAdminClient,
  getAuthenticatedUser,
  getUserPrimaryAccountId,
} from '../_shared/supabase.ts'

const GMAIL_RECONNECT_MESSAGE =
  'Gmail access expired or was revoked. Reconnect Gmail in Settings, then try sending again.'

type SendRequest = {
  body?: string
  clientName?: string
  contactNumber?: number
  scheduledFor?: string
  subject?: string
  to?: string
}

function assertSendRequest(input: SendRequest) {
  if (!input.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) {
    throw new Error('A valid recipient email is required.')
  }

  if (!input.subject?.trim()) {
    throw new Error('Email subject is required.')
  }

  if (!input.body?.trim()) {
    throw new Error('Email body is required.')
  }

  return {
    body: input.body,
    clientName: input.clientName?.trim() || null,
    contactNumber: Number.isFinite(input.contactNumber) ? input.contactNumber : null,
    scheduledFor: input.scheduledFor || null,
    subject: input.subject,
    to: input.to,
  }
}

async function markConnectionRevoked(
  supabase: ReturnType<typeof createAdminClient>,
  connectionId: string,
) {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('gmail_connections')
    .update({
      revoked_at: now,
      updated_at: now,
    })
    .eq('id', connectionId)

  if (error) {
    console.error('Unable to mark Gmail connection revoked', error.message)
  }
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)

  if (optionsResponse) {
    return optionsResponse
  }

  let supabase: ReturnType<typeof createAdminClient> | null = null
  let userId: string | null = null
  let accountId: string | null = null
  let connectionId: string | null = null
  let payload: ReturnType<typeof assertSendRequest> | null = null

  try {
    supabase = createAdminClient()
    const user = await getAuthenticatedUser(req)
    userId = user.id
    accountId = await getUserPrimaryAccountId(supabase, user.id)
    payload = assertSendRequest((await req.json()) as SendRequest)

    const { data: connection, error: connectionError } = await supabase
      .from('gmail_connections')
      .select('id,email,encrypted_refresh_token,account_id')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .maybeSingle()

    if (connectionError) {
      throw new Error(connectionError.message)
    }

    if (!connection) {
      return jsonResponse({
        message: 'Gmail is not connected. Falling back to browser draft.',
        reason: 'not_connected',
        sent: false,
      })
    }

    connectionId = connection.id

    const refreshToken = await decryptToken(connection.encrypted_refresh_token)
    const token = await refreshGoogleAccessToken(refreshToken)
    const raw = createRawEmailMessage({
      body: payload.body,
      from: connection.email,
      subject: payload.subject,
      to: payload.to,
    })
    const sentMessage = await sendGmailMessage(token.access_token, raw)
    const logAccountId =
      typeof connection.account_id === 'string' ? connection.account_id : accountId

    await supabase.from('gmail_send_logs').insert({
      account_id: logAccountId,
      client_name: payload.clientName,
      contact_number: payload.contactNumber,
      gmail_connection_id: connection.id,
      gmail_message_id: sentMessage.id,
      recipient: payload.to,
      scheduled_for: payload.scheduledFor,
      status: 'sent',
      subject: payload.subject,
      user_id: user.id,
    })

    return jsonResponse({
      fromEmail: connection.email,
      messageId: sentMessage.id,
      sent: true,
    })
  } catch (error) {
    const reconnectRequired = isGoogleRefreshTokenInvalidError(error)
    const message = reconnectRequired
      ? GMAIL_RECONNECT_MESSAGE
      : error instanceof Error
        ? error.message
        : 'Gmail send failed.'

    if (supabase && connectionId && reconnectRequired) {
      await markConnectionRevoked(supabase, connectionId)
    }

    if (supabase && userId && payload) {
      await supabase.from('gmail_send_logs').insert({
        account_id: accountId,
        client_name: payload.clientName,
        contact_number: payload.contactNumber,
        error: message,
        gmail_connection_id: connectionId,
        recipient: payload.to,
        scheduled_for: payload.scheduledFor,
        status: 'failed',
        subject: payload.subject,
        user_id: userId,
      })
    }

    return jsonResponse(
      {
        error: message,
        message,
        reason: reconnectRequired ? 'gmail_reconnect_required' : 'gmail_send_failed',
        sent: false,
      },
      { status: reconnectRequired ? 409 : 500 },
    )
  }
})
