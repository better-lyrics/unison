import { Elysia, t } from "elysia"
import { config } from "@/config"
import { markAuditFailed, runMigration } from "@/db/account-migration"
import { getByDiscordId } from "@/db/discordLinks"
import { invalidateCuratorLeaderboardCache } from "@/db/leaderboard"
import { invalidateCacheForSubmitter } from "@/db/lyrics"
import { Logger } from "@/infra/logger"
import { recalculateScore } from "@/jobs/score-updater"
import type { Env } from "@/types"
import { isLinkBlacklisted } from "@/utils/blacklist"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import {
	clearDiscordIndex,
	commitLockKey,
	createSession,
	getActiveSessionForDiscord,
	getSession,
	saveSession,
} from "@/utils/migration-session"
import { shortKeyId } from "@/utils/short-key-id"

const log = new Logger("migrations")

const bodyDiscordId = t.Object({ discordId: t.String() })
const bodyCommit = t.Object({
	discordId: t.String(),
	keepNickname: t.Optional(t.Union([t.Literal("old"), t.Literal("new")])),
})
const paramsSession = t.Object({ sessionId: t.String() })

export const migrationRoutes = (env: Env) =>
	new Elysia({ prefix: "/migrations" })
		.decorate("env", env)
		.post(
			"/bot/start",
			async ({ env, headers, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const { discordId } = body

				const link = await getByDiscordId(env, discordId)
				if (!link) return status(400, buildError(ErrorCode.NOT_LINKED))
				const oldKey = link.key_id
				if (isLinkBlacklisted(oldKey)) {
					return status(403, buildError(ErrorCode.LINK_BLACKLISTED))
				}

				const active = await getActiveSessionForDiscord(env, discordId)
				if (active) return status(409, buildError(ErrorCode.MIGRATION_ALREADY_ACTIVE))

				const oauth = env.DISCORD_OAUTH
				if (!oauth) return status(503, buildError(ErrorCode.LINKING_DISABLED))

				const session = await createSession(env, { discordId, oldKey })
				const signUrl = `${new URL(oauth.redirectUri).origin}/migrate?session=${session.sessionId}`

				log.info("migration started", { discordId, sessionId: session.sessionId })
				return status(200, {
					success: true,
					data: {
						sessionId: session.sessionId,
						signUrl,
						oldKeyId: shortKeyId(oldKey),
						status: "awaiting_new_key",
					},
				})
			},
			{ body: bodyDiscordId }
		)
		.get(
			"/bot/:sessionId",
			async ({ env, headers, params, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const session = await getSession(env, params.sessionId)
				if (!session) {
					return status(200, {
						success: true,
						data: {
							status: "expired",
							oldKeyId: null,
							newKeyId: null,
							oldNickname: null,
							newNickname: null,
							counts: null,
						},
					})
				}
				return status(200, {
					success: true,
					data: {
						status: session.status,
						oldKeyId: shortKeyId(session.oldKey),
						newKeyId: session.newKey ? shortKeyId(session.newKey) : null,
						oldNickname: session.oldNickname,
						newNickname: session.newNickname,
						counts: session.counts,
					},
				})
			},
			{ params: paramsSession }
		)
		.post(
			"/bot/:sessionId/commit",
			async ({ env, headers, params, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const { discordId, keepNickname } = body

				const session = await getSession(env, params.sessionId)
				if (!session) return status(410, buildError(ErrorCode.MIGRATION_EXPIRED))
				if (session.status === "committed") {
					return status(409, buildError(ErrorCode.MIGRATION_ALREADY_COMMITTED))
				}
				if (session.status !== "ready" || session.newKey === null || session.migrationId === null) {
					return status(409, buildError(ErrorCode.MIGRATION_NOT_READY))
				}

				if (discordId !== session.discordId) {
					return status(403, buildError(ErrorCode.MIGRATION_NOT_OWNER))
				}
				const link = await getByDiscordId(env, discordId)
				if (!link || link.key_id !== session.oldKey) {
					return status(403, buildError(ErrorCode.MIGRATION_NOT_OWNER))
				}

				const lockKey = commitLockKey(session.sessionId)
				const locked = await env.CACHE.setNX(lockKey, "1", config.migration.commitLockSeconds)
				if (!locked) return status(409, buildError(ErrorCode.MIGRATION_IN_PROGRESS))

				const result = await runMigration(env, {
					oldKey: session.oldKey,
					newKey: session.newKey,
					keepNickname: keepNickname ?? "old",
					migrationId: session.migrationId,
				})
				if ("error" in result) {
					await env.CACHE.delete(lockKey)
					await markAuditFailed(env, session.migrationId, result.error)
					await saveSession(env, { ...session, status: "failed", failureReason: result.error })
					log.error("migration commit failed", { sessionId: session.sessionId, error: result.error })
					return status(500, buildError(ErrorCode.MIGRATION_FAILED))
				}

				await saveSession(env, { ...session, status: "committed" })
				await clearDiscordIndex(env, discordId)

				await invalidateCuratorLeaderboardCache(env)
				await invalidateCacheForSubmitter(env, session.newKey)
				for (const lyricsId of result.affectedLyricsIds) {
					recalculateScore(env, lyricsId).catch((err) =>
						log.error("post-migration recalc failed", { lyricsId, error: String(err) })
					)
				}

				log.info("migration committed", {
					sessionId: session.sessionId,
					migrationId: session.migrationId,
					moved: result.moved,
				})
				return status(200, {
					success: true,
					data: { migrationId: session.migrationId, moved: result.moved },
				})
			},
			{ params: paramsSession, body: bodyCommit }
		)
