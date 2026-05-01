import { Hono } from 'hono'
import { sign, verify } from 'hono/jwt'
import { AppHttpError } from '../lib/errors'
import type { AppBindings, AppVariables } from '../types/app'

export const authRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>()

authRoute.post('/link-token', async (c) => {
  const body = await c.req.json()
  const secret = c.env.SESSION_TOKEN_SECRET
  const user = c.get('auth')

  const { sessionToken, candidateUserId, state } = body

  if (!sessionToken || !candidateUserId || !state || !secret) {
    throw new AppHttpError(400, 'BAD_REQUEST', 'Parámetros incompletos')
  }

  // 1. Verificar el sessionToken emitido por la Action de Auth0
  let payload: any
  try {
    payload = await verify(sessionToken, secret, 'HS256')
  } catch (e) {
    throw new AppHttpError(400, 'BAD_REQUEST', 'Token de sesión inválido')
  }

  const { current_identity, candidate_identities } = payload
  const selectedCandidate = (candidate_identities || []).find((c: any) => c.user_id === candidateUserId)

  if (!selectedCandidate || !current_identity) {
    throw new AppHttpError(400, 'BAD_REQUEST', 'Datos de enlace no encontrados en la sesión')
  }

  // 2. Seguridad: El usuario logueado en la PWA (vía Bearer) debe ser el candidato (DB)
  if (user.userId !== candidateUserId) {
    throw new AppHttpError(403, 'FORBIDDEN', 'No tienes permiso para enlazar esta cuenta.')
  }

  // 3. Generar el proof-token firmado para que Auth0 confíe en nosotros
  const now = Math.floor(Date.now() / 1000)
  const proofToken = await sign(
    {
      primary_identity: {
        user_id: selectedCandidate.user_id,
        provider: selectedCandidate.provider,
        connection: selectedCandidate.connection,
      },
      secondary_identity: {
        user_id: current_identity.user_id,
        provider: current_identity.provider,
        connection: current_identity.connection,
      },
      state,
      iat: now,
      exp: now + 300,
    },
    secret,
    'HS256'
  )

  return c.json({ ok: true, data: { proofToken } })
})
