import { createHash } from "node:crypto"
import { CATALOGUE } from "@/db/badges/definitions"
import { resolveKeyIdByHandle } from "@/db/users"
import { log } from "@/infra/logger"
import {
	type ProfileCard,
	type SongCard,
	loadProfileCard,
	loadSongCard,
	profileAccent,
	songAccent,
} from "@/og/render"
import type { Env } from "@/types"
import { SYNC_KINDS, type SyncKind, syncTypeFor } from "@/utils/sync-type"
import { isVideoId } from "@/utils/video-id"
import { levelProgress } from "@/utils/xp"

const SHARE_TTL_SECONDS = 300
const ACCENT_TTL_SECONDS = 60 * 60 * 24 * 30
const KEY_ID = /^[0-9a-fA-F]{64}$/

export interface Share {
	title: string
	description: string
	themeColor: string
	image: string
	author: { name: string; path: string }
}

export interface ShareLoaders {
	song: (env: Env, videoId: string) => Promise<Share | null>
	profile: (env: Env, keyId: string) => Promise<Share | null>
}

export type SongShareInput = {
	videoId: string
	top: Pick<
		SongCard["top"],
		"id" | "song" | "artist" | "album" | "sync_type" | "format" | "upvotes"
	>
	versions: number
	sealed: boolean
	person: Pick<NonNullable<SongCard["person"]>, "displayName" | "avatarUrl" | "keyId"> | null
	artwork: string | null
}

export type ProfileShareInput = Pick<
	ProfileCard,
	"keyId" | "rank" | "identity" | "gamification" | "tier" | "banner"
>

const syncLine = (kind: SyncKind) =>
	kind === "unsynced" ? SYNC_KINDS.unsynced.label : `${SYNC_KINDS[kind].label} synced`

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const hash = (inputs: unknown) =>
	createHash("sha1").update(JSON.stringify(inputs)).digest("base64url").slice(0, 10)

export function songVersion(card: SongShareInput): string {
	const { top, person } = card
	return hash([
		top.id,
		top.song,
		top.artist,
		top.album,
		syncTypeFor(top.sync_type, top.format),
		card.versions,
		card.sealed,
		person?.displayName,
		person?.avatarUrl,
		card.artwork,
	])
}

export function profileVersion(card: ProfileShareInput): string {
	const { rank, identity, gamification } = card
	return hash([
		identity.displayName,
		identity.handle,
		identity.avatarUrl,
		card.banner?.artworkUrl,
		card.tier,
		gamification.level,
		Math.round(levelProgress(gamification.xp, gamification.xpForNext, gamification.xpFloor) * 20),
		gamification.counts.earned,
		gamification.featured,
		rank?.rank,
		rank?.submissionCount,
		rank?.totalUpvotes,
	])
}

export function songShare(card: SongShareInput, themeColor: string): Share {
	const { top, person } = card
	const details = [
		syncLine(syncTypeFor(top.sync_type, top.format)),
		card.sealed ? "Council sealed" : null,
		plural(top.upvotes, "upvote"),
		card.versions > 1 ? plural(card.versions, "version") : null,
	]
	return {
		title: `${top.song} · ${top.artist}`,
		description: details.filter(Boolean).join(" · "),
		themeColor,
		image: `/og/song/${card.videoId}.jpg?v=${songVersion(card)}`,
		author: person
			? { name: `Synced by ${person.displayName}`, path: `/curator/${person.keyId}` }
			: { name: "Unison", path: "/" },
	}
}

export function profileShare(card: ProfileShareInput, themeColor: string): Share {
	const { rank, identity, gamification } = card
	const tierName = card.tier ? CATALOGUE.find((b) => b.key === card.tier)?.name : null
	return {
		title: identity.displayName,
		description: rank
			? [
					`${plural(rank.submissionCount, "song")} synced`,
					plural(rank.totalUpvotes, "upvote"),
					plural(gamification.counts.earned, "badge"),
				].join(" · ")
			: "New curator on Unison",
		themeColor,
		image: `/og/user/${card.keyId}.jpg?v=${profileVersion(card)}`,
		author: {
			name: rank && tierName ? `${tierName} curator · Rank #${rank.rank}` : "New curator",
			path: `/curator/${card.keyId}`,
		},
	}
}

async function cached<T>(env: Env, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
	const hit = await env.CACHE.get(key)
	if (hit !== null) return JSON.parse(hit)
	const value = await load()
	if (value !== null) await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl })
	return value
}

export const shareLoaders: ShareLoaders = {
	song: (env, videoId) =>
		cached(env, `share:song:${videoId}`, SHARE_TTL_SECONDS, async () => {
			const card = await loadSongCard(env, videoId)
			if (!card) return null
			const input = { ...card, videoId }
			const accent = await cached(
				env,
				`share:accent:song:${songVersion(input)}`,
				ACCENT_TTL_SECONDS,
				() => songAccent(card)
			)
			return songShare(input, accent)
		}),
	profile: (env, keyId) =>
		cached(env, `share:profile:${keyId}`, SHARE_TTL_SECONDS, async () => {
			const card = await loadProfileCard(env, keyId)
			if (!card) return null
			const accent = await cached(
				env,
				`share:accent:profile:${profileVersion(card)}`,
				ACCENT_TTL_SECONDS,
				() => profileAccent(env, keyId)
			)
			return accent ? profileShare(card, accent) : null
		}),
}

export function requestOrigin(request: Request): string {
	const url = new URL(request.url)
	const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
	const host = request.headers.get("host") ?? url.host
	return `${proto ?? url.protocol.replace(":", "")}://${host}`
}

async function findShare(env: Env, pathname: string, loaders: ShareLoaders) {
	const [, section, id] = pathname.split("/")
	if (!id || pathname.split("/").length !== 3) return null
	const decoded = decodeURIComponent(id)
	if (section === "song" && isVideoId(decoded)) return loaders.song(env, decoded)
	if (section === "curator" && KEY_ID.test(decoded)) return loaders.profile(env, decoded)
	if (section === "u") {
		const keyId = await resolveKeyIdByHandle(env, decoded)
		return keyId ? loaders.profile(env, keyId) : null
	}
	return null
}

const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
	)

export function shareTags(share: Share, origin: string, pathname: string): string {
	const page = `${origin}${pathname}`
	const image = `${origin}${share.image}`
	const oembed = `${origin}/oembed?url=${encodeURIComponent(page)}&format=json`
	const meta = (attr: "name" | "property", key: string, value: string) =>
		`<meta ${attr}="${key}" content="${escapeHtml(value)}" />`
	return [
		`<title>${escapeHtml(share.title)}</title>`,
		meta("name", "description", share.description),
		meta("name", "theme-color", share.themeColor),
		meta("property", "og:site_name", "Unison"),
		meta("property", "og:type", "website"),
		meta("property", "og:url", page),
		meta("property", "og:title", share.title),
		meta("property", "og:description", share.description),
		meta("property", "og:image", image),
		meta("property", "og:image:width", "1200"),
		meta("property", "og:image:height", "630"),
		meta("name", "twitter:card", "summary_large_image"),
		meta("name", "twitter:title", share.title),
		meta("name", "twitter:description", share.description),
		meta("name", "twitter:image", image),
		`<link rel="alternate" type="application/json+oembed" href="${escapeHtml(oembed)}" />`,
	].join("")
}

export function injectShare(indexHtml: string, tags: string): string {
	return indexHtml
		.replace(/<title>[\s\S]*?<\/title>/, "")
		.replace(/<meta name="(description|theme-color)"[^>]*>/g, "")
		.replace("</head>", `${tags}</head>`)
}

export async function sharePage(
	env: Env,
	request: Request,
	indexHtml: string,
	loaders: ShareLoaders = shareLoaders
): Promise<string> {
	const { pathname } = new URL(request.url)
	try {
		const share = await findShare(env, pathname, loaders)
		return share
			? injectShare(indexHtml, shareTags(share, requestOrigin(request), pathname))
			: indexHtml
	} catch (error) {
		log.warn("share meta failed", { pathname, error: (error as Error).message })
		return indexHtml
	}
}
