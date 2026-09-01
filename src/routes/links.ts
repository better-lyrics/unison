import { Elysia, t } from "elysia"
import { config } from "@/config"
import { computeMigrationPlan, createPreviewAudit } from "@/db/account-migration"
import { getByKeyId, linkDiscord, listLinks, unlinkByKeyId } from "@/db/discordLinks"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"
import { eitherAuth } from "@/utils/either-auth"
import { signedRequest } from "@/utils/auth"
import { isLinkBlacklisted } from "@/utils/blacklist"
import { isAuthorizedBot } from "@/utils/bot-auth"
import type { DiscordIdentity } from "@/utils/discord-oauth"
import { buildAuthorizeUrl, exchangeCodeForUser } from "@/utils/discord-oauth"
import { ErrorCode, buildError } from "@/utils/errors"
import { getActiveSessionForDiscord, type MigrationSession, saveSession } from "@/utils/migration-session"
import { generateSessionToken } from "@/utils/session"

const log = new Logger("links")

const LINK_STATE_PREFIX = "link_state:"
const LINK_PAGE = "/link"
const MIGRATE_PAGE = "/migrate"

function redirectPage(page: string, status: string, name?: string): Response {
	const params = new URLSearchParams({ status })
	if (name) params.set("name", name)
	return new Response(null, {
		status: 302,
		headers: { location: `${page}?${params.toString()}` },
	})
}

const redirectToLinkPage = (status: string, name?: string) => redirectPage(LINK_PAGE, status, name)
const redirectToMigratePage = (status: string, name?: string) =>
	redirectPage(MIGRATE_PAGE, status, name)

// Proof-of-new-key branch of the Discord link flow. When the Discord that just
// completed OAuth has an active migration session, this link IS the proof: attach
// the proven key to the session instead of relinking Discord, so the old link
// survives for commit-time re-verification.
async function attachMigrationProof(
	env: Env,
	session: MigrationSession,
	provenKeyId: string,
	identity: DiscordIdentity
): Promise<Response> {
	if (session.status === "ready") return redirectToMigratePage("ready")

	if (provenKeyId === session.oldKey) {
		await saveSession(env, { ...session, status: "failed", failureReason: "same_key" })
		return redirectToMigratePage("same_key")
	}

	const plan = await computeMigrationPlan(env, session.oldKey, provenKeyId)
	if ("error" in plan) {
		await saveSession(env, { ...session, status: "failed", failureReason: plan.error })
		return redirectToMigratePage("error")
	}

	const migrationId = await createPreviewAudit(env, {
		sessionId: session.sessionId,
		discordId: session.discordId,
		oldKey: session.oldKey,
		newKey: provenKeyId,
		counts: plan.counts,
	})
	await saveSession(env, {
		...session,
		newKey: provenKeyId,
		counts: plan.counts,
		oldNickname: plan.oldNickname,
		newNickname: plan.newNickname,
		status: "ready",
		migrationId,
	})
	log.info("migration new key proven", { sessionId: session.sessionId, migrationId })
	return redirectToMigratePage("ready", identity.displayName)
}

export const linkStartRoutes = (env: Env) =>
	new Elysia({ prefix: "/links" })
		.decorate("env", env)
		.use(signedRequest)
		.post("/discord/start", async ({ env, keyId, status }) => {
			const oauth = env.DISCORD_OAUTH
			if (!oauth) {
				return status(503, buildError(ErrorCode.LINKING_DISABLED))
			}
			if (isLinkBlacklisted(keyId)) {
				log.warn("blacklisted key attempted to start a link", { keyId })
				return status(403, buildError(ErrorCode.LINK_BLACKLISTED))
			}

			const state = generateSessionToken()
			await env.CACHE.put(`${LINK_STATE_PREFIX}${state}`, keyId, {
				expirationTtl: config.linking.stateTtlSeconds,
			})
			const authorizeUrl = buildAuthorizeUrl(oauth, state, config.linking.discordScope)
			return status(200, { success: true, data: { authorizeUrl } })
		})

export const linkRoutes = (env: Env, fetchImpl: typeof fetch = fetch) =>
	new Elysia({ prefix: "/links" })
		.decorate("env", env)
		.get(
			"/discord/callback",
			async ({ env, query }) => {
				const { code, state } = query
				if (!code || !state) return redirectToLinkPage("error")

				const keyId = await env.CACHE.getDel(`${LINK_STATE_PREFIX}${state}`)
				if (!keyId) return redirectToLinkPage("expired")
				if (isLinkBlacklisted(keyId)) {
					log.warn("blacklisted key reached link callback", { keyId })
					return redirectToLinkPage("blocked")
				}

				const oauth = env.DISCORD_OAUTH
				if (!oauth) return redirectToLinkPage("error")

				let identity: Awaited<ReturnType<typeof exchangeCodeForUser>>
				try {
					identity = await exchangeCodeForUser(oauth, code, fetchImpl)
				} catch (err) {
					log.warn("discord oauth exchange failed", { error: (err as Error).message })
					return redirectToLinkPage("error")
				}

				const migration = await getActiveSessionForDiscord(env, identity.id)
				if (migration) {
					return attachMigrationProof(env, migration, keyId, identity)
				}

				await linkDiscord(env, {
					discordId: identity.id,
					keyId,
					discordUsername: identity.displayName,
				})
				log.info("account linked", { keyId, discordId: identity.id })
				return redirectToLinkPage("linked", identity.displayName)
			},
			{ query: t.Object({ code: t.Optional(t.String()), state: t.Optional(t.String()) }) }
		)
		.get("/bot/all", async ({ env, headers, status }) => {
			if (!isAuthorizedBot(headers.authorization, env)) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}
			const links = await listLinks(env)
			return status(200, { success: true, data: { links } })
		})
		.get("/bot/blacklist", ({ env, headers, status }) => {
			if (!isAuthorizedBot(headers.authorization, env)) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}
			return status(200, { success: true, data: { keyIds: [...config.linking.blacklistedKeyIds] } })
		})
		.use(eitherAuth)
		.get("/me", async ({ env, keyId, status }) => {
			const link = await getByKeyId(env, keyId)
			return status(200, {
				success: true,
				data: {
					linked: link !== null,
					discordId: link?.discord_id ?? null,
					discordUsername: link?.discord_username ?? null,
				},
			})
		})
		.delete("/discord", async ({ env, keyId, status }) => {
			await unlinkByKeyId(env, keyId)
			return status(200, { success: true, data: { unlinked: true } })
		})
