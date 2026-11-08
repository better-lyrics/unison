import { config } from "@/config"
import { getUserBadges } from "@/db/badges"
import { CATALOGUE, badgeImageFile } from "@/db/badges/definitions"
import { getGlobalFeed } from "@/db/feed"
import { getCuratorLeaderboard, getCuratorRank } from "@/db/leaderboard"
import { countVariantsByVideoId, findByVideoId } from "@/db/lyrics"
import { getSubmissionsByUser } from "@/db/profile"
import { getProfileExtras } from "@/db/profile-settings"
import { getUserByKeyId, resolveIdentity, resolvePeople, resolvePeopleByKeyIds } from "@/db/users"
import { buildSealMarks } from "@/routes/marks"
import { resolveArtworkCover } from "@/services/artwork"
import { type DumpStats, readDumpStats } from "@/services/dump-manifest"
import type { Env } from "@/types"
import { type Accent, accentHex, inks, scrimFor } from "@/utils/accent"
import { syncTypeFor } from "@/utils/sync-type"
import { levelProgress } from "@/utils/xp"
import { render } from "takumi-js"
import { inksFor } from "./components"
import { ogFonts } from "./fonts"
import {
	avatarBytes,
	backedImage,
	badgeArt,
	badgeSilhouette,
	coverBytes,
	coverImage,
	fingerprint,
	mosaic,
	sampleAccent,
	sleeveBytes,
	washFrom,
} from "./images"
import { type Page, pageCardNode } from "./page-cards"
import {
	CARD_SIZE,
	type Gem,
	type ProfileBase,
	profileDownloadNode,
	profileWallNode,
} from "./profile-card"
import { profileQrUrl, qrModules } from "./qr"
import { songCardNode } from "./song-card"

export interface RenderedCard {
	bytes: Buffer
	accent: string
}

type RenderInput = Parameters<typeof render>[0]
type ImageSource = { src: string; data: Uint8Array; cache?: "auto" | "none" }

const OG = { width: 1200, height: 630 }
const CARD_SCALE = 3
const JPEG_QUALITY = 88
const WALL_SUBMISSIONS = 24
const WALL_COVER_SIZE = 400

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })

class Images {
	readonly list: ImageSource[] = []

	add(name: string, data: Uint8Array): string {
		this.list.push({ src: `og:${name}`, data, cache: "none" })
		return `og:${name}`
	}

	asset(name: string, data: Uint8Array): string {
		this.list.push({ src: `asset:${name}`, data, cache: "auto" })
		return `asset:${name}`
	}
}

type Encoding = { format: "jpeg"; quality: number } | { format: "png" }

const OG_JPEG: Encoding = { format: "jpeg", quality: JPEG_QUALITY }

async function encode(
	node: RenderInput,
	images: Images,
	encoding: Encoding,
	size: { width: number; height: number },
	devicePixelRatio = 1
): Promise<Buffer> {
	const fonts = await ogFonts()
	const out = await render(node, {
		width: size.width * devicePixelRatio,
		height: size.height * devicePixelRatio,
		...encoding,
		devicePixelRatio,
		fonts,
		images: images.list,
	})
	return Buffer.from(out)
}

function badgeFile(key: string, variant?: string, tier?: number | null): string | null {
	const def = CATALOGUE.find((b) => b.key === key)
	return def ? badgeImageFile(def, variant, tier) : null
}

async function badgeGem(images: Images, key: string, tier?: number | null): Promise<Gem | null> {
	const artFile = badgeFile(key, undefined, tier)
	const silhouetteFile = badgeFile(key, "silhouette")
	if (!artFile) return null
	const [art, silhouette] = await Promise.all([
		badgeArt(artFile),
		silhouetteFile ? badgeSilhouette(silhouetteFile) : null,
	])
	if (!art) return null
	return {
		art: images.asset(`badge:${artFile}`, art),
		silhouette: silhouette ? images.asset(`silhouette:${silhouetteFile}`, silhouette) : null,
	}
}

function palette(accent: Accent) {
	return {
		scrim: scrimFor(accent.lum),
		ink: inksFor(inks(accent.hue)),
		accent: accentHex(accent.hue),
	}
}

export async function loadSongCard(env: Env, videoId: string) {
	const top = await findByVideoId(env, videoId)
	if (!top) return null
	const [versions, cover, marks, people] = await Promise.all([
		countVariantsByVideoId(env, videoId),
		resolveArtworkCover(env, videoId),
		buildSealMarks(env, [top]),
		top.submitter_id == null ? null : resolvePeople(env, [top.submitter_id]),
	])
	return {
		top,
		versions,
		sealed: marks.has(Number(top.id)),
		person: top.submitter_id == null ? null : (people?.get(top.submitter_id) ?? null),
		artwork: cover?.url ?? null,
		cover,
	}
}

export type SongCard = NonNullable<Awaited<ReturnType<typeof loadSongCard>>>

async function songArt(card: SongCard): Promise<Buffer> {
	const cover = card.cover ? await coverImage(card.cover) : null
	return cover ?? sleeveBytes(card.top.song, card.top.artist)
}

export async function songAccent(card: SongCard): Promise<string> {
	return accentHex((await sampleAccent(await songArt(card))).hue)
}

export async function renderSongOg(env: Env, videoId: string): Promise<RenderedCard | null> {
	const card = await loadSongCard(env, videoId)
	if (!card) return null
	const { top, person, sealed } = card
	const art = await songArt(card)
	const [wash, accent, avatar, seal] = await Promise.all([
		washFrom(art, OG.width, OG.height),
		sampleAccent(art),
		person ? avatarBytes(person.avatarUrl, person.keyId) : null,
		sealed ? badgeArt("committee.svg") : null,
	])
	const images = new Images()
	const { scrim, ink, accent: hex } = palette(accent)
	const node = songCardNode({
		song: top.song,
		artist: top.artist,
		album: top.album,
		sync: syncTypeFor(top.sync_type, top.format),
		versions: card.versions,
		sealed,
		submitter:
			person && avatar
				? { displayName: person.displayName, avatar: images.add("avatar", avatar) }
				: null,
		cover: images.add("cover", art),
		wash: images.add("wash", wash),
		seal: seal ? images.asset("seal", seal) : null,
		scrim,
		ink,
	})
	return { bytes: await encode(node, images, OG_JPEG, OG), accent: hex }
}

export async function loadProfileCard(env: Env, keyId: string) {
	const user = await getUserByKeyId(env, keyId)
	if (!user) return null
	const [rank, identity, gamification, extras] = await Promise.all([
		getCuratorRank(env, keyId),
		resolveIdentity(env, keyId),
		getUserBadges(env, keyId),
		getProfileExtras(env, keyId, null),
	])
	const tier = rank?.community ? null : gamification.tier
	return { keyId, rank, identity, gamification, tier, banner: extras.banner ?? null }
}

export type ProfileCard = NonNullable<Awaited<ReturnType<typeof loadProfileCard>>>

async function loadProfile(env: Env, keyId: string) {
	const card = await loadProfileCard(env, keyId)
	if (!card) return null
	const [avatar, banner] = await Promise.all([
		avatarBytes(card.identity.avatarUrl, keyId),
		card.banner ? coverBytes(env, card.banner.videoId) : null,
	])
	const backed = await backedImage(avatar, await sampleAccent(avatar))
	return { ...card, avatar: backed, banner }
}

export async function profileAccent(env: Env, keyId: string): Promise<string | null> {
	const profile = await loadProfile(env, keyId)
	return profile ? accentHex((await sampleAccent(profile.banner ?? profile.avatar)).hue) : null
}

type Profile = NonNullable<Awaited<ReturnType<typeof loadProfile>>>

async function profileBase(
	images: Images,
	profile: Profile,
	washSource: Buffer,
	wash: { width: number; height: number }
): Promise<{ base: ProfileBase; accent: string }> {
	const { rank, identity, gamification, tier } = profile
	const [washBytes, accent, gem] = await Promise.all([
		washFrom(washSource, wash.width, wash.height),
		sampleAccent(washSource),
		tier ? badgeGem(images, tier) : null,
	])
	const { scrim, ink, accent: hex } = palette(accent)
	return {
		accent: hex,
		base: {
			name: identity.displayName,
			tier,
			tierGem: gem,
			rank: rank ? rank.rank : null,
			level: gamification.level,
			progress: levelProgress(gamification.xp, gamification.xpForNext, gamification.xpFloor),
			avatar: images.add("avatar", profile.avatar),
			wash: images.add("wash", washBytes),
			scrim,
			ink,
		},
	}
}

async function wallCovers(env: Env, keyId: string): Promise<Buffer[]> {
	const rows = await getSubmissionsByUser(env, keyId, WALL_SUBMISSIONS, null)
	const videoIds = [...new Set(rows.filter((r) => !r.hidden).map((r) => r.videoId))]
	const fetched = await Promise.all(videoIds.map((id) => coverBytes(env, id, WALL_COVER_SIZE)))
	const covers: Buffer[] = []
	const seen = new Set<string>()
	for (const bytes of fetched) {
		if (!bytes) continue
		const print = await fingerprint(bytes).catch(() => null)
		if (!print || seen.has(print)) continue
		seen.add(print)
		covers.push(bytes)
	}
	return covers
}

export async function renderProfileOg(env: Env, keyId: string): Promise<RenderedCard | null> {
	const profile = await loadProfile(env, keyId)
	if (!profile) return null
	const images = new Images()
	const [{ base, accent }, covers] = await Promise.all([
		profileBase(images, profile, profile.banner ?? profile.avatar, OG),
		profile.rank ? wallCovers(env, keyId) : [],
	])
	const { rank, gamification } = profile
	const node = profileWallNode({
		...base,
		covers: covers.map((bytes, i) => images.add(`cover-${i}`, bytes)),
		stats: rank
			? [
					[String(rank.submissionCount), "Songs synced"],
					[compact.format(rank.totalUpvotes), "Upvotes"],
					[String(gamification.counts.earned), "Badges"],
				]
			: null,
	})
	return { bytes: await encode(node, images, OG_JPEG, OG), accent }
}

export async function renderProfileDownload(env: Env, keyId: string): Promise<RenderedCard | null> {
	const profile = await loadProfile(env, keyId)
	if (!profile) return null
	const { rank, identity, gamification } = profile
	const washSource =
		profile.banner ??
		(identity.avatarUrl ? profile.avatar : await sleeveBytes(identity.displayName, keyId))
	const images = new Images()
	const { base, accent } = await profileBase(images, profile, washSource, {
		width: CARD_SIZE.width * CARD_SCALE,
		height: CARD_SIZE.height * CARD_SCALE,
	})
	const featured = await Promise.all(
		gamification.featured
			.slice(0, config.gamification.featured.maxSlots)
			.map((key) => badgeGem(images, key, gamification.badges.find((b) => b.key === key)?.tier))
	)
	const node = profileDownloadNode({
		...base,
		handle: identity.handle,
		qr: identity.handle ? qrModules(profileQrUrl(identity.handle)) : null,
		banner: profile.banner ? images.add("banner", profile.banner) : null,
		featured: featured.filter((gem): gem is Gem => gem !== null),
		stats: [
			[String(rank ? rank.submissionCount : 0), "Songs synced"],
			[compact.format(rank ? rank.totalUpvotes : 0), "Upvotes"],
			[String(gamification.counts.earned), "Badges"],
		],
	})
	return { bytes: await encode(node, images, { format: "png" }, CARD_SIZE, CARD_SCALE), accent }
}

const HOME_MOSAIC = 9
const SHELF = 4
const SEALED_FEED = 12
const PODIUM = 3
const PAGE_COVER_SIZE = 400

async function topVideoIds(env: Env): Promise<string[]> {
	const feed = await getGlobalFeed(env, HOME_MOSAIC, undefined, undefined, { sort: "top-rated" })
	return [...new Set(feed.map((item) => item.video_id))]
}

async function sealedVideoIds(env: Env): Promise<string[]> {
	const feed = await getGlobalFeed(env, SEALED_FEED, undefined, undefined, {
		sealed: true,
		sort: "recently-sealed",
	})
	return [...new Set(feed.map((item) => item.video_id))].slice(0, SHELF)
}

async function podium(env: Env) {
	const board = await getCuratorLeaderboard(env, config.requests.leaderboard.topN)
	const top = board.filter((row) => !row.community).slice(0, PODIUM)
	const people = await resolvePeopleByKeyIds(
		env,
		top.map((row) => row.keyId)
	)
	return top.map((row) => ({
		keyId: row.keyId,
		name: people.get(row.keyId)?.displayName ?? row.keyId.slice(0, 8),
		avatarUrl: row.avatarUrl,
		tier: row.tier,
		lyrics: row.submissionCount,
		upvotes: row.totalUpvotes,
	}))
}

export type PageSource =
	| { page: "home"; lyrics: number | null; top: string[] }
	| { page: "leaderboard"; curators: Awaited<ReturnType<typeof podium>> }
	| { page: "sealed" | "docs"; sealed: string[] }
	| { page: "downloads"; stats: DumpStats | null; top: string[] }

export async function loadPageCard(env: Env, page: Page): Promise<PageSource> {
	switch (page) {
		case "home": {
			const [stats, top] = await Promise.all([readDumpStats(env), topVideoIds(env)])
			return { page, lyrics: stats?.lyrics ?? null, top }
		}
		case "leaderboard":
			return { page, curators: await podium(env) }
		case "sealed":
		case "docs":
			return { page, sealed: await sealedVideoIds(env) }
		case "downloads": {
			const [stats, top] = await Promise.all([readDumpStats(env), topVideoIds(env)])
			return { page, stats, top: top.slice(3, 3 + SHELF) }
		}
	}
}

export function pageWashKey(source: PageSource): unknown {
	switch (source.page) {
		case "home":
		case "downloads":
			return [source.page, source.top]
		case "leaderboard":
			return [source.page, source.curators[0]?.keyId, source.curators[0]?.avatarUrl]
		case "sealed":
			return [source.page, source.sealed[0]]
		case "docs":
			return [source.page, source.sealed]
	}
}

async function pageCovers(env: Env, videoIds: string[]): Promise<Buffer[]> {
	const covers = await Promise.all(videoIds.map((id) => coverBytes(env, id, PAGE_COVER_SIZE)))
	return covers.filter((cover): cover is Buffer => cover !== null)
}

async function mosaicOf(env: Env, videoIds: string[], cols: number): Promise<Buffer | null> {
	const covers = await pageCovers(env, videoIds)
	return covers.length ? mosaic(covers, covers.length < cols ? covers.length : cols) : null
}

async function pageWashSource(env: Env, source: PageSource): Promise<Buffer> {
	let bytes: Buffer | null = null
	switch (source.page) {
		case "home":
			bytes = await mosaicOf(env, source.top, 3)
			break
		case "leaderboard": {
			const first = source.curators[0]
			bytes = first ? await avatarBytes(first.avatarUrl, first.keyId) : null
			break
		}
		case "sealed":
			bytes = source.sealed[0] ? await coverBytes(env, source.sealed[0], PAGE_COVER_SIZE) : null
			break
		case "docs":
			bytes = await mosaicOf(env, source.sealed, 2)
			break
		case "downloads":
			bytes = await mosaicOf(env, source.top, 2)
			break
	}
	return bytes ?? sleeveBytes("Unison", source.page)
}

export async function pageAccent(env: Env, source: PageSource): Promise<string> {
	return accentHex((await sampleAccent(await pageWashSource(env, source))).hue)
}

export async function renderPageOg(env: Env, source: PageSource): Promise<RenderedCard> {
	const art = await pageWashSource(env, source)
	const [wash, accent] = await Promise.all([washFrom(art, OG.width, OG.height), sampleAccent(art)])
	const images = new Images()
	const washSrc = images.add("wash", wash)
	const node = await (async () => {
		switch (source.page) {
			case "home":
				return pageCardNode({ page: "home", wash: washSrc, lyrics: source.lyrics })
			case "leaderboard": {
				const rows = await Promise.all(
					source.curators.map(async (curator, i) => {
						const gemFile = curator.tier ? badgeFile(curator.tier) : null
						const [avatar, gem] = await Promise.all([
							avatarBytes(curator.avatarUrl, curator.keyId),
							gemFile ? badgeArt(gemFile) : null,
						])
						return {
							name: curator.name,
							avatar: images.add(`avatar-${i}`, avatar),
							gem: gem && gemFile ? images.asset(`badge:${gemFile}`, gem) : null,
							lyrics: curator.lyrics,
							upvotes: curator.upvotes,
						}
					})
				)
				return pageCardNode({ page: "leaderboard", wash: washSrc, curators: rows })
			}
			case "sealed": {
				const [covers, seal] = await Promise.all([
					pageCovers(env, source.sealed),
					badgeArt("committee.svg"),
				])
				return pageCardNode({
					page: "sealed",
					wash: washSrc,
					seal: seal ? images.asset("seal", seal) : null,
					covers: covers.map((bytes, i) => images.add(`cover-${i}`, bytes)),
				})
			}
			case "docs":
				return pageCardNode({ page: "docs", wash: washSrc })
			case "downloads":
				return pageCardNode({ page: "downloads", wash: washSrc, stats: source.stats })
		}
	})()
	return { bytes: await encode(node, images, OG_JPEG, OG), accent: accentHex(accent.hue) }
}
