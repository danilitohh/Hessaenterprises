import { decryptToken } from '../_shared/crypto.ts'
import { createRawEmailMessage, refreshGoogleAccessToken, sendGmailMessage } from '../_shared/google.ts'
import { handleOptions, jsonResponse } from '../_shared/http.ts'
import { createAdminClient, getAuthenticatedUser } from '../_shared/supabase.ts'

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

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)

  if (optionsResponse) {
    return optionsResponse
  }

  let supabase: ReturnType<typeof createAdminClient> | null = null
  let userId: string | null = null
  let connectionId: string | null = null
  let payload: ReturnType<typeof assertSendRequest> | null = null

  try {
    supabase = createAdminClient()
    const user = await getAuthenticatedUser(req)
    userId = user.id
    payload = assertSendRequest((await req.json()) as SendRequest)

    const { data: connection, error: connectionError } = await supabase
      .from('gmail_connections')
      .select('id,email,encrypted_refresh_token')
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

    await supabase.from('gmail_send_logs').insert({
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
    if (supabase && userId && payload) {
      await supabase.from('gmail_send_logs').insert({
        client_name: payload.clientName,
        contact_number: payload.contactNumber,
        error: error instanceof Error ? error.message : 'Gmail send failed.',
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
        error: error instanceof Error ? error.message : 'Unable to send Gmail follow-up.',
        reason: 'gmail_send_failed',
        sent: false,
      },
      { status: 500 },
    )
  }
})
