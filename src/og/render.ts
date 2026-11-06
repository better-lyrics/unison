import { config } from "@/config"
import { getUserBadges } from "@/db/badges"
import { CATALOGUE, badgeImageFile } from "@/db/badges/definitions"
import { getCuratorRank } from "@/db/leaderboard"
import { findVariantsByVideoId } from "@/db/lyrics"
import { getSubmissionsByUser } from "@/db/profile"
import { getProfileExtras } from "@/db/profile-settings"
import { getUserByKeyId, resolveIdentity, resolvePeople } from "@/db/users"
import { buildSealMarks } from "@/routes/marks"
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
	fingerprint,
	sampleAccent,
	sleeveBytes,
	washFrom,
} from "./images"
import {
	CARD_SIZE,
	type Gem,
	type ProfileBase,
	profileDownloadNode,
	profileWallNode,
} from "./profile-card"
import { songCardNode } from "./song-card"

export interface RenderedCard {
	bytes: Buffer
	accent: string
}

type RenderInput = Parameters<typeof render>[0]
type ImageSource = { src: string; data: Uint8Array; cache?: "auto" | "none" }

const OG = { width: 1200, height: 630 }
const OG_WASH = { width: 600, height: 315 }
const CARD_SCALE = 3
const JPEG_QUALITY = 88
const VARIANT_LIMIT = 50
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

async function tierGem(images: Images, tier: string): Promise<Gem | null> {
	const artFile = badgeFile(tier)
	const silhouetteFile = badgeFile(tier, "silhouette")
	if (!artFile) return null
	const [art, silhouette] = await Promise.all([
		badgeArt(artFile),
		silhouetteFile ? badgeSilhouette(silhouetteFile) : null,
	])
	if (!art) return null
	return {
		art: images.asset(`badge:${tier}`, art),
		silhouette: silhouette ? images.asset(`silhouette:${tier}`, silhouette) : null,
	}
}

function palette(accent: Accent) {
	return {
		scrim: scrimFor(accent.lum),
		ink: inksFor(inks(accent.hue)),
		accent: accentHex(accent.hue),
	}
}

export async function renderSongOg(env: Env, videoId: string): Promise<RenderedCard | null> {
	const variants = await findVariantsByVideoId(env, videoId, VARIANT_LIMIT)
	const top = variants[0]
	if (!top) return null
	const [cover, marks, people] = await Promise.all([
		coverBytes(env, videoId),
		buildSealMarks(env, [top]),
		top.submitter_id == null ? null : resolvePeople(env, [top.submitter_id]),
	])
	const art = cover ?? (await sleeveBytes(top.song, top.artist))
	const person = top.submitter_id == null ? undefined : people?.get(top.submitter_id)
	const sealed = marks.has(Number(top.id))
	const [wash, accent, avatar, seal] = await Promise.all([
		washFrom(art, OG_WASH.width, OG_WASH.height),
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
		versions: variants.length,
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

async function loadProfile(env: Env, keyId: string) {
	const user = await getUserByKeyId(env, keyId)
	if (!user) return null
	const [rank, identity, gamification, extras] = await Promise.all([
		getCuratorRank(env, keyId),
		resolveIdentity(env, keyId),
		getUserBadges(env, keyId),
		getProfileExtras(env, keyId, null),
	])
	const tier = rank?.community ? null : gamification.tier
	const [avatar, banner] = await Promise.all([
		avatarBytes(identity.avatarUrl, keyId),
		extras.banner ? coverBytes(env, extras.banner.videoId) : null,
	])
	const backed = await backedImage(avatar, await sampleAccent(avatar))
	return { rank, identity, gamification, tier, avatar: backed, banner }
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
		tier ? tierGem(images, tier) : null,
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
		profileBase(images, profile, profile.banner ?? profile.avatar, OG_WASH),
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
	const { base, accent } = await profileBase(images, profile, washSource, CARD_SIZE)
	const featured = await Promise.all(
		gamification.featured.slice(0, config.gamification.featured.maxSlots).map(async (key) => {
			const tier = gamification.badges.find((b) => b.key === key)?.tier
			const file = badgeFile(key, undefined, tier)
			const art = file ? await badgeArt(file) : null
			return art ? images.asset(`badge:${file}`, art) : null
		})
	)
	const node = profileDownloadNode({
		...base,
		handle: identity.handle,
		banner: profile.banner ? images.add("banner", profile.banner) : null,
		featured: featured.filter((src): src is string => src !== null),
		stats: [
			[String(rank ? rank.submissionCount : 0), "Songs synced"],
			[compact.format(rank ? rank.totalUpvotes : 0), "Upvotes"],
			[String(gamification.counts.earned), "Badges"],
		],
	})
	return { bytes: await encode(node, images, { format: "png" }, CARD_SIZE, CARD_SCALE), accent }
}
