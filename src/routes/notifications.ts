import { config } from "@/config"
import {
	type NotificationItem,
	ackDiscord,
	discordOptOut,
	discordQueue,
	getDiscordDm,
	listNotifications,
	markSeen,
	setDiscordDm,
	unreadCount,
} from "@/db/notifications"
import { NOTIFICATION_KINDS } from "@/notifications/kinds"
import { resolveActors } from "@/routes/marks"
import type { Env, MarkActor } from "@/types"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { DISCORD_ID_PATTERN } from "@/utils/discord-oauth"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"
import { bearerKeyId } from "@/utils/session"
import { Elysia, status, t } from "elysia"

function actorIdOf(item: NotificationItem): number | null {
	if (item.kind !== "suggestion_council_decided") return item.actorId
	return typeof item.data.authorId === "number" ? item.data.authorId : null
}

function toWire(item: NotificationItem, actors: Map<number, MarkActor>) {
	const actorId = actorIdOf(item)
	const actor = actorId === null ? undefined : actors.get(actorId)
	const { authorId: _, ...data } = item.data
	return {
		id: item.id,
		kind: item.kind,
		group: NOTIFICATION_KINDS[item.kind].group,
		createdAt: item.createdAt,
		unread: item.unread,
		refStatus: item.refStatus,
		actor: actor
			? { keyId: actor.keyId, displayName: actor.displayName, avatarUrl: actor.avatarUrl }
			: null,
		song: item.lyric
			? {
					lyricsId: item.lyric.id,
					videoId: item.lyric.videoId,
					song: item.lyric.song,
					artist: item.lyric.artist,
				}
			: null,
		data: { ...data, revisionId: item.refId },
	}
}

async function toWireItems(env: Env, items: NotificationItem[]) {
	const actors = await resolveActors(env, items.map(actorIdOf))
	return items.map((item) => toWire(item, actors))
}

const webRoutes = (env: Env) =>
	new Elysia({ prefix: "/notifications" })
		.decorate("env", env)
		.derive(async ({ headers, env }) => {
			const keyId = await bearerKeyId(env, headers.authorization)
			const user = keyId
				? await env.DB.prepare("SELECT id FROM users WHERE key_id = ?")
						.bind(keyId)
						.first<{ id: number }>()
				: null
			if (!user) return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			return { userId: user.id }
		})
		.post("/seen", async ({ env, userId }) => {
			await markSeen(env.DB, userId)
			return { success: true, data: { seen: true } }
		})
		.get("/settings", async ({ env, userId }) => ({
			success: true,
			data: { discordDm: await getDiscordDm(env.DB, userId) },
		}))
		.put(
			"/settings",
			async ({ env, userId, body }) => {
				await setDiscordDm(env.DB, userId, body.discordDm)
				return { success: true, data: { discordDm: body.discordDm } }
			},
			{ body: t.Object({ discordDm: t.Boolean() }) }
		)
		.use(readRateLimit)
		.get("/unread", async ({ env, userId }) => ({
			success: true,
			data: { unread: await unreadCount(env.DB, userId) },
		}))
		.get("", async ({ env, userId }) => {
			const { unread, items } = await listNotifications(env.DB, userId)
			return { success: true, data: { unread, items: await toWireItems(env, items) } }
		})

const botRoutes = (env: Env) =>
	new Elysia({ prefix: "/notifications/bot/discord" })
		.decorate("env", env)
		.onBeforeHandle(({ env, headers }) => {
			if (!isAuthorizedBot(headers.authorization, env)) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}
		})
		.get("", async ({ env }) => {
			const queue = await discordQueue(env.DB)
			const wire = await toWireItems(env, queue)
			return {
				success: true,
				data: { items: wire.map((item, i) => ({ ...item, discordId: queue[i].discordId })) },
			}
		})
		.post(
			"/ack",
			async ({ env, body }) => ({
				success: true,
				data: { acked: await ackDiscord(env.DB, body.ids) },
			}),
			{
				body: t.Object({
					ids: t.Array(t.Integer({ minimum: 1 }), {
						maxItems: config.notifications.discordBatchMax,
					}),
				}),
			}
		)
		.put(
			"/opt-out",
			async ({ env, body }) => ({
				success: true,
				data: { optedOut: await discordOptOut(env.DB, body.discordId) },
			}),
			{ body: t.Object({ discordId: t.String({ pattern: DISCORD_ID_PATTERN }) }) }
		)

export const notificationRoutes = (env: Env) => new Elysia().use(webRoutes(env)).use(botRoutes(env))
