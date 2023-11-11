import { Hono } from 'hono'
import { ResultSetHeader } from 'mysql2/promise'
import { ApplicationDeps, HonoEnvironment } from '../types'
import { verifyUserSessionMiddleware } from '../middlewares/verify-user-session-middleare'
import { defaultUserIDKey } from '../contants'
import { makeReactionResponse } from '../utils/make-reaction-response'

export const reactionHandler = (deps: ApplicationDeps) => {
  const handler = new Hono<HonoEnvironment>()

  handler.post(
    '/api/livestream/:livestream_id/reaction',
    verifyUserSessionMiddleware,
    async (c) => {
      const userId = c.get('session').get(defaultUserIDKey) as number // userId is verified by verifyUserSessionMiddleware
      const livestreamId = Number.parseInt(c.req.param('livestream_id'), 10)
      if (Number.isNaN(livestreamId)) {
        return c.text('livestream_id in path must be integer', 400)
      }

      const body = await c.req.json<{ emoji_name: string }>()

      await deps.connection.beginTransaction()

      const now = Date.now()
      const reactionResult = await deps.connection
        .query<ResultSetHeader>(
          'INSERT INTO reactions (user_id, livestream_id, emoji_name, created_at) VALUES (?, ?, ?, ?)',
          [userId, livestreamId, body.emoji_name, now],
        )
        .then(([result]) => ({ ok: true, data: result.insertId }) as const)
        .catch((error) => ({ ok: false, error }) as const)
      if (!reactionResult.ok) {
        await deps.connection.rollback()
        return c.text('failed to insert reaction', 500)
      }

      const reactionResponse = await makeReactionResponse(deps, {
        id: reactionResult.data,
        emoji_name: body.emoji_name,
        user_id: userId,
        livestream_id: livestreamId,
        created_at: now,
      })
      if (!reactionResponse.ok) {
        await deps.connection.rollback()
        return c.text(reactionResponse.error, 500)
      }

      try {
        await deps.connection.commit()
      } catch {
        await deps.connection.rollback()
        return c.text('failed to commit', 500)
      }

      return c.json(reactionResponse, 201)
    },
  )

  return handler
}
