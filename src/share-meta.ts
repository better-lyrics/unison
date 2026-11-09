import { createHash } from "node:crypto"
import { config } from "@/config"
import { CATALOGUE } from "@/db/badges/definitions"
import { resolveKeyIdByHandle } from "@/db/users"
import { log } from "@/infra/logger"
import { PAGE_COPY, PAGE_PATHS, type Page } from "@/og/page-cards"
import {
	type PageSource,
	type ProfileCard,
	type SongCard,
	loadPageCard,
	loadProfileCard,
	loadSongCard,
	pageAccent,
	pageWashKey,
	profileAccent,
	songAccent,
} from "@/og/render"
import type { Env } from "@/types"
import { sharedInFlight } from "@/utils/in-flight"
import { SYNC_KINDS, type SyncKind, syncTypeFor } from "@/utils/sync-type"
import { isVideoId } from "@/utils/video-id"
import { levelProgress } from "@/utils/xp"

const SHARE_TTL_SECONDS = 300
const MISS_TTL_SECONDS = 60
const ACCENT_TTL_SECONDS = 60 * 60 * 24 * 30
const KEY_ID = /^[0-9a-fA-F]{64}$/
const NICKNAME = new RegExp(config.auth.nickname.pattern)

export interface Share {
	title: string
	description: string
	themeColor: string
	image: string
	imageAlt: string
	version: string
	author: { name: string; path: string }
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

const syncLine = (kind: SyncKind) => {
	if (kind === "unsynced") return SYNC_KINDS.unsynced.label
	if (kind === "syllable") return "Richsynced"
	return `${SYNC_KINDS[kind].label} synced`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const CARD_DESIGN = 5

const hash = (inputs: unknown[]) =>
	createHash("sha1")
		.update(JSON.stringify([CARD_DESIGN, ...inputs]))
		.digest("base64url")
		.slice(0, 10)

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
		gamification.featured.map((key) => [key, gamification.badges.find((b) => b.key === key)?.tier]),
		rank?.rank,
		rank?.submissionCount,
		rank?.totalUpvotes,
	])
}

export function songShare(card: SongShareInput, themeColor: string): Share {
	const { top, person } = card
	const version = songVersion(card)
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
		image: `/og/song/${card.videoId}.jpg?v=${version}`,
		imageAlt: `${top.song} by ${top.artist}`,
		version,
		author: person
			? { name: `Synced by ${person.displayName}`, path: `/curator/${person.keyId}` }
			: { name: "Unison", path: "/" },
	}
}

export function profileShare(card: ProfileShareInput, themeColor: string): Share {
	const { rank, identity, gamification } = card
	const tierName = card.tier ? CATALOGUE.find((b) => b.key === card.tier)?.name : null
	const version = profileVersion(card)
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
		image: `/og/user/${card.keyId}.jpg?v=${version}`,
		imageAlt: `${identity.displayName} on Unison`,
		version,
		author: {
			name: rank && tierName ? `${tierName} curator · Rank #${rank.rank}` : "New curator",
			path: `/curator/${card.keyId}`,
		},
	}
}

export const pageVersion = (source: PageSource) => hash([source])

export function pageShare(source: PageSource, themeColor: string): Share {
	const copy = PAGE_COPY[source.page]
	const subtitle =
		source.page === "home"
			? PAGE_COPY.home.subtitle(source.lyrics)
			: PAGE_COPY[source.page].subtitle
	const version = pageVersion(source)
	return {
		title: copy.title,
		description: source.page === "home" ? PAGE_COPY.home.description : subtitle,
		themeColor,
		image: `/og/page/${source.page}.jpg?v=${version}`,
		imageAlt: `${copy.headline.join(" ")} ${subtitle}`,
		version,
		author: { name: "Unison", path: "/" },
	}
}

const pageInFlight = sharedInFlight<Share>()

async function cached<T>(env: Env, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
	const hit = await env.CACHE.get(key)
	if (hit !== null) return JSON.parse(hit)
	const value = await load()
	await env.CACHE.put(key, JSON.stringify(value), {
		expirationTtl: value === null ? MISS_TTL_SECONDS : ttl,
	})
	return value
}

export const shareLoaders = {
	song: (env: Env, videoId: string): Promise<Share | null> =>
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
	profile: (env: Env, keyId: string): Promise<Share | null> =>
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
	page: (env: Env, page: Page): Promise<Share> =>
		pageInFlight(`share:page:${page}`, () =>
			cached(env, `share:page:${page}`, SHARE_TTL_SECONDS, async () => {
				const source = await loadPageCard(env, page)
				const accent = await cached(
					env,
					`share:accent:page:${hash([pageWashKey(source)])}`,
					ACCENT_TTL_SECONDS,
					() => pageAccent(env, source)
				)
				return pageShare(source, accent)
			})
		),
}

export function requestOrigin(request: Request): string {
	const url = new URL(request.url)
	const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
	const host = request.headers.get("host") ?? url.host
	return `${proto ?? url.protocol.replace(":", "")}://${host}`
}

const pagePath = (pathname: string) =>
	(pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname).toLowerCase()

export function pageFor(pathname: string): Page | null {
	return PAGE_PATHS[pagePath(pathname)] ?? null
}

async function findShare(env: Env, pathname: string): Promise<Share> {
	const page = pageFor(pathname)
	if (page) return shareLoaders.page(env, page)
	return (await findItemShare(env, pathname)) ?? shareLoaders.page(env, "home")
}

async function findItemShare(env: Env, pathname: string): Promise<Share | null> {
	const [, rawSection, id] = pathname.split("/")
	const section = rawSection?.toLowerCase()
	if (!id || pathname.split("/").length !== 3) return null
	let decoded: string
	try {
		decoded = decodeURIComponent(id)
	} catch {
		return null
	}
	if (section === "song" && isVideoId(decoded)) return shareLoaders.song(env, decoded)
	if (section === "curator" && KEY_ID.test(decoded)) return shareLoaders.profile(env, decoded)
	if (section === "u" && NICKNAME.test(decoded)) {
		const keyId = await cached(
			env,
			`share:handle:${decoded.toLowerCase()}`,
			SHARE_TTL_SECONDS,
			() => resolveKeyIdByHandle(env, decoded)
		)
		return keyId ? shareLoaders.profile(env, keyId) : null
	}
	return null
}

const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
	)

const WEBSITE_LD = JSON.stringify({
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "Unison",
	url: config.og.siteOrigin,
	potentialAction: {
		"@type": "SearchAction",
		target: `${config.og.siteOrigin}/search?q={search_term_string}`,
		"query-input": "required name=search_term_string",
	},
}).replace(/</g, "\\u003c")

export function shareTags(share: Share, origin: string, pathname: string): string {
	const path = pageFor(pathname) ? pagePath(pathname) : pathname
	const page = `${origin}${path}`
	const canonical = `${config.og.siteOrigin}${path}`
	const image = `${origin}${share.image}`
	const oembed = `${origin}/oembed?url=${encodeURIComponent(page)}&format=json`
	const meta = (attr: "name" | "property", key: string, value: string) =>
		`<meta ${attr}="${key}" content="${escapeHtml(value)}" />`
	return [
		`<title>${escapeHtml(share.title)}</title>`,
		meta("name", "description", share.description),
		meta("name", "theme-color", share.themeColor),
		`<link rel="canonical" href="${escapeHtml(canonical)}" />`,
		meta("property", "og:site_name", "Unison"),
		meta("property", "og:type", "website"),
		meta("property", "og:locale", "en_US"),
		meta("property", "og:url", page),
		meta("property", "og:title", share.title),
		meta("property", "og:description", share.description),
		meta("property", "og:image", image),
		meta("property", "og:image:width", "1200"),
		meta("property", "og:image:height", "630"),
		meta("property", "og:image:type", "image/jpeg"),
		meta("property", "og:image:alt", share.imageAlt),
		meta("name", "twitter:card", "summary_large_image"),
		meta("name", "twitter:title", share.title),
		meta("name", "twitter:description", share.description),
		meta("name", "twitter:image", image),
		meta("name", "twitter:image:alt", share.imageAlt),
		pathname === "/" ? `<script type="application/ld+json">${WEBSITE_LD}</script>` : "",
		`<link rel="alternate" type="application/json+oembed" href="${escapeHtml(oembed)}" />`,
	].join("")
}

export function injectShare(indexHtml: string, tags: string): string {
	return indexHtml
		.replace(/<title>[\s\S]*?<\/title>/, "")
		.replace(/<meta name="(description|theme-color)"[^>]*>/g, "")
		.replace("</head>", () => `${tags}</head>`)
}

export async function sharePage(env: Env, request: Request, indexHtml: string): Promise<string> {
	const { pathname } = new URL(request.url)
	try {
		const share = await findShare(env, pathname)
		return injectShare(indexHtml, shareTags(share, requestOrigin(request), pathname))
	} catch (error) {
		log.warn("share meta failed", { pathname, error: (error as Error).message })
		return indexHtml
	}
}

export async function oembedFor(env: Env, request: Request, target: string) {
	const origin = requestOrigin(request)
	let url: URL
	try {
		url = new URL(target)
	} catch {
		return null
	}
	if (url.origin !== origin) return null
	const share = await findShare(env, url.pathname)
	return {
		version: "1.0",
		type: "link",
		title: share.title,
		provider_name: "Unison",
		provider_url: origin,
		author_name: share.author.name,
		author_url: `${origin}${share.author.path}`,
	}
}
