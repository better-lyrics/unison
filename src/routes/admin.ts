import { randomUUID } from "node:crypto"
import { config } from "@/config"
import {
	type MigrationRunError,
	computeMigrationPlan,
	createPreviewAudit,
	getAudit,
	listAudits,
	markAuditFailed,
	markAuditReverted,
	restoreFromSnapshot,
	runMigration,
} from "@/db/account-migration"
import { getByKeyId } from "@/db/discordLinks"
import { invalidateCuratorLeaderboardCache } from "@/db/leaderboard"
import { invalidateCacheForSubmitter } from "@/db/lyrics"
import { type AccountSearchRow, getUserByKeyId, searchAccounts } from "@/db/users"
import { Logger } from "@/infra/logger"
import { recalculateScore } from "@/jobs/score-updater"
import type { Env } from "@/types"
import { isAuthorizedAdmin } from "@/utils/admin-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import { shortKeyId } from "@/utils/short-key-id"
import { Elysia, NotFoundError, t } from "elysia"

const log = new Logger("admin")

const SEARCH_DEFAULT_LIMIT = 25
const SEARCH_MAX_LIMIT = 50
const MIN_QUERY_LENGTH = 2

function clampLimit(raw: string | undefined): number {
	const n = raw ? Number.parseInt(raw, 10) : Number.NaN
	if (!Number.isFinite(n) || n <= 0) return SEARCH_DEFAULT_LIMIT
	return Math.min(n, SEARCH_MAX_LIMIT)
}

function toAccountHit(row: AccountSearchRow) {
	return {
		userId: row.id,
		keyId: row.key_id,
		keyShort: shortKeyId(row.key_id),
		nickname: row.nickname,
		discordId: row.discord_id,
		discordUsername: row.discord_username,
		reputation: row.reputation,
		submissions: row.submissions,
		votes: row.votes,
		reports: row.reports,
		requests: row.requests,
	}
}

const querySearch = t.Object({ q: t.Optional(t.String()), limit: t.Optional(t.String()) })
const bodyKeys = t.Object({
	oldKey: t.String({ minLength: 8 }),
	newKey: t.String({ minLength: 8 }),
})
const bodyCommit = t.Optional(
	t.Object({
		keepNickname: t.Optional(t.Union([t.Literal("old"), t.Literal("new")])),
	})
)
const paramsId = t.Object({ id: t.Numeric() })

const RUN_ERROR: Record<MigrationRunError["error"], { httpStatus: number; code: ErrorCode }> = {
	SAME_KEY: { httpStatus: 409, code: ErrorCode.MIGRATION_SAME_KEY },
	OLD_KEY_NO_USER: { httpStatus: 404, code: ErrorCode.MIGRATION_OLD_KEY_NO_USER },
	BOTH_KEYS_LINKED: { httpStatus: 409, code: ErrorCode.MIGRATION_BOTH_KEYS_LINKED },
}

type RestoreError = "NOT_FOUND" | "NOT_COMMITTED" | "HAS_INTERIM_ACTIVITY"
const RESTORE_ERROR: Record<RestoreError, { httpStatus: number; code: ErrorCode }> = {
	NOT_FOUND: { httpStatus: 404, code: ErrorCode.MIGRATION_NOT_FOUND },
	NOT_COMMITTED: { httpStatus: 409, code: ErrorCode.MIGRATION_NOT_COMMITTED },
	HAS_INTERIM_ACTIVITY: { httpStatus: 409, code: ErrorCode.MIGRATION_HAS_INTERIM_ACTIVITY },
}

const commitLockKey = (id: number) => `admin:migration:commit:${id}`

export const adminRoutes = (env: Env) =>
	new Elysia({ prefix: "/admin" })
		.decorate("env", env)
		// Deploy-dark: with no ADMIN_SECRET the whole surface is 404 (indistinguishable
		// from a route that does not exist). With a secret set, unauthorized is 401.
		.onBeforeHandle(({ env, headers, status }) => {
			if (!env.ADMIN_SECRET) throw new NotFoundError()
			if (!isAuthorizedAdmin(headers.authorization, env)) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}
		})
		.get(
			"/accounts/search",
			async ({ env, query, status }) => {
				const q = (query.q ?? "").trim()
				if (q.length < MIN_QUERY_LENGTH) {
					return status(
						400,
						buildError(ErrorCode.MISSING_QUERY, {
							error: "Query too short",
							hint: "Enter at least 2 characters to search accounts.",
						})
					)
				}
				const rows = await searchAccounts(env, q, clampLimit(query.limit))
				return status(200, { success: true, data: rows.map(toAccountHit) })
			},
			{ query: querySearch }
		)
		.post(
			"/migrations/preview",
			async ({ env, body, status }) => {
				const { oldKey, newKey } = body
				if (oldKey === newKey) return status(409, buildError(ErrorCode.MIGRATION_SAME_KEY))

				const [oldLink, newLink] = await Promise.all([
					getByKeyId(env, oldKey),
					getByKeyId(env, newKey),
				])
				if (oldLink && newLink) {
					return status(409, buildError(ErrorCode.MIGRATION_BOTH_KEYS_LINKED))
				}

				const plan = await computeMigrationPlan(env, oldKey, newKey)
				if ("error" in plan) {
					return status(404, buildError(ErrorCode.MIGRATION_OLD_KEY_NO_USER))
				}

				const migrationId = await createPreviewAudit(env, {
					sessionId: `admin:${randomUUID()}`,
					discordId: "admin",
					oldKey,
					newKey,
					counts: plan.counts,
				})

				return status(200, {
					success: true,
					data: { migrationId, plan: { ...plan, survivingNickname: plan.oldNickname } },
				})
			},
			{ body: bodyKeys }
		)
		.post(
			"/migrations/:id/commit",
			async ({ env, params, body, status }) => {
				const id = params.id
				const audit = await getAudit(env, id)
				if (!audit) return status(404, buildError(ErrorCode.MIGRATION_NOT_FOUND))
				if (audit.status === "committed") {
					return status(409, buildError(ErrorCode.MIGRATION_ALREADY_COMMITTED))
				}
				if (audit.status !== "preview") {
					return status(409, buildError(ErrorCode.MIGRATION_FAILED))
				}

				const lockKey = commitLockKey(id)
				const locked = await env.CACHE.setNX(lockKey, "1", config.migration.commitLockSeconds)
				if (!locked) return status(409, buildError(ErrorCode.MIGRATION_IN_PROGRESS))

				try {
					const result = await runMigration(env, {
						oldKey: audit.old_key,
						newKey: audit.new_key,
						keepNickname: body?.keepNickname ?? "old",
						migrationId: id,
					})
					if ("error" in result) {
						await env.CACHE.delete(lockKey)
						await markAuditFailed(env, id, result.error)
						log.error("admin migration commit failed", { migrationId: id, error: result.error })
						const mapped = RUN_ERROR[result.error]
						return status(mapped.httpStatus, buildError(mapped.code))
					}

					await invalidateCuratorLeaderboardCache(env)
					await invalidateCacheForSubmitter(env, audit.new_key)
					for (const lyricsId of result.affectedLyricsIds) {
						recalculateScore(env, lyricsId).catch((err) =>
							log.error("post-migration recalc failed", { lyricsId, error: String(err) })
						)
					}

					const verification = await getAudit(env, id)
					log.info("admin migration committed", { migrationId: id, moved: result.moved })
					return status(200, {
						success: true,
						data: {
							moved: result.moved,
							verification: verification && {
								status: verification.status,
								moved: {
									submissions: verification.moved_submissions,
									votes: verification.moved_votes,
									reports: verification.moved_reports,
									fulfillments: verification.moved_fulfillments,
									collisionsDropped: verification.collisions_dropped,
								},
							},
						},
					})
				} catch (err) {
					await env.CACHE.delete(lockKey).catch(() => {})
					await markAuditFailed(env, id, err instanceof Error ? err.message : String(err)).catch(
						() => {}
					)
					throw err
				}
			},
			{ params: paramsId, body: bodyCommit }
		)
		.post(
			"/migrations/:id/undo",
			async ({ env, params, status }) => {
				const audit = await getAudit(env, params.id)
				if (!audit) return status(404, buildError(ErrorCode.MIGRATION_NOT_FOUND))
				if (audit.status !== "committed") {
					return status(409, buildError(ErrorCode.MIGRATION_NOT_COMMITTED))
				}
				// Already restored: the snapshot was consumed, or the old key resolves to a
				// user again. Re-running would collide, so refuse cleanly instead of 500ing.
				if (!audit.snapshot || (await getUserByKeyId(env, audit.old_key))) {
					return status(409, buildError(ErrorCode.MIGRATION_ALREADY_RESTORED))
				}

				const result = await restoreFromSnapshot(env, params.id)
				if ("error" in result) {
					const mapped = RESTORE_ERROR[result.error]
					return status(mapped.httpStatus, buildError(mapped.code))
				}
				await markAuditReverted(env, params.id)
				log.info("admin migration undone", { migrationId: params.id })
				return status(200, { success: true, data: { restored: true } })
			},
			{ params: paramsId }
		)
		.get(
			"/migrations",
			async ({ env, query, status }) => {
				const rows = await listAudits(env, clampLimit(query.limit))
				return status(200, { success: true, data: rows })
			},
			{ query: t.Object({ limit: t.Optional(t.String()) }) }
		)
		.get(
			"/migrations/:id",
			async ({ env, params, status }) => {
				const audit = await getAudit(env, params.id)
				if (!audit) return status(404, buildError(ErrorCode.MIGRATION_NOT_FOUND))
				const { snapshot, ...rest } = audit
				return status(200, { success: true, data: { ...rest, hasSnapshot: snapshot !== null } })
			},
			{ params: paramsId }
		)
