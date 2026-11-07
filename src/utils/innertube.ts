import { config } from "@/config"
import { Logger } from "@/infra/logger"
import { isAlbumArtUrl, pickSquareArtwork } from "@/utils/artwork"
import { Innertube } from "youtubei.js"

const log = new Logger("innertube")
let client: Promise<Innertube> | null = null

function getInnertube(): Promise<Innertube> {
	if (!client) {
		client = Innertube.create({ retrieve_player: false }).catch((err) => {
			client = null
			throw err
		})
	}
	return client
}

export const BASIC_INFO_CLIENT = "ANDROID_VR"

function validSeconds(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

type UpNextVideo = {
	video_id?: string
	duration?: { seconds?: number }
	thumbnail?: { url: string; width: number; height: number }[]
}

const EMPTY_QUEUE = "Music queue was empty"

async function upNextEntry(yt: Innertube, videoId: string): Promise<UpNextVideo[] | null> {
	const panel = await yt.music.getUpNext(videoId, false)
	for (const entry of panel.contents) {
		const videos = "primary" in entry ? [entry.primary, ...(entry.counterpart ?? [])] : [entry]
		const known = videos.filter((v): v is NonNullable<typeof v> => !!v) as UpNextVideo[]
		if (known.some((v) => v.video_id === videoId)) return known
	}
	return null
}

async function upNextDurationSeconds(yt: Innertube, videoId: string): Promise<number | null> {
	const video = (await upNextEntry(yt, videoId))?.find((v) => v.video_id === videoId)
	return validSeconds(video?.duration?.seconds)
}

export async function videoArtwork(videoId: string): Promise<string | null> {
	const yt = await getInnertube()
	let entry: UpNextVideo[] | null
	try {
		entry = await upNextEntry(yt, videoId)
	} catch (err) {
		if ((err as Error).message.startsWith(EMPTY_QUEUE)) return null
		throw err
	}
	for (const video of entry ?? []) {
		const art = pickSquareArtwork(video.thumbnail ?? [], config.artwork.size)
		if (art && isAlbumArtUrl(art)) return art
	}
	return null
}

async function playerDurationSeconds(yt: Innertube, videoId: string): Promise<number | null> {
	const info = await yt.getBasicInfo(videoId, { client: BASIC_INFO_CLIENT })
	const duration = validSeconds(info.basic_info?.duration)
	if (duration === null) {
		log.warn("innertube player gave no duration", {
			videoId,
			status: info.playability_status?.status,
		})
	}
	return duration
}

type DurationLookup = (yt: Innertube, videoId: string) => Promise<number | null>

async function tryLookup(
	source: string,
	lookup: DurationLookup,
	yt: Innertube,
	videoId: string
): Promise<number | null> {
	try {
		return await lookup(yt, videoId)
	} catch (err) {
		log.warn("innertube duration resolve failed", {
			source,
			videoId,
			error: (err as Error).message,
		})
		return null
	}
}

export async function getVideoDurationSeconds(videoId: string): Promise<number | null> {
	let yt: Innertube
	try {
		yt = await getInnertube()
	} catch (err) {
		log.warn("innertube client init failed", { videoId, error: (err as Error).message })
		return null
	}
	return (
		(await tryLookup("up-next", upNextDurationSeconds, yt, videoId)) ??
		(await tryLookup("player", playerDurationSeconds, yt, videoId))
	)
}

export type SongCandidate = {
	videoId: string
	title: string
	artist: string
	artists: string[]
	artistChannelIds: string[]
	album: string | null
	durationSeconds: number | null
	videoType: "song" | "video"
	artworkUrl: string | null
}

type MusicSearchItem = {
	id?: string
	title?: string
	artists?: { name?: string; channel_id?: string }[]
	authors?: { name?: string; channel_id?: string }[]
	album?: { name?: string }
	duration?: { seconds?: number }
	thumbnails?: { url: string; width: number; height: number }[]
}

function toCandidate(
	it: MusicSearchItem,
	videoType: SongCandidate["videoType"]
): SongCandidate | null {
	if (typeof it.id !== "string") return null
	const credits = it.artists ?? it.authors ?? []
	const artists = credits
		.map((a) => a.name)
		.filter((n): n is string => typeof n === "string" && n.length > 0)
	const artistChannelIds = credits
		.map((a) => a.channel_id)
		.filter((id): id is string => typeof id === "string" && id.length > 0)
	return {
		videoId: it.id,
		title: it.title ?? "",
		artist: artists[0] ?? "",
		artists,
		artistChannelIds,
		album: it.album?.name ?? null,
		durationSeconds: it.duration?.seconds ?? null,
		videoType,
		artworkUrl: pickSquareArtwork(it.thumbnails ?? [], config.artwork.size),
	}
}

// The unfiltered search no longer groups results into Songs and Videos shelves, so each filter is queried on its own.
async function searchShelf(
	query: string,
	videoType: SongCandidate["videoType"]
): Promise<SongCandidate[]> {
	try {
		const yt = await getInnertube()
		const res = await yt.music.search(query, { type: videoType })
		const shelf = videoType === "song" ? res.songs : res.videos
		const items = shelf?.contents ?? []
		return items
			.map((it) => toCandidate(it, videoType))
			.filter((c): c is SongCandidate => c !== null)
	} catch (err) {
		log.warn("innertube song search failed", { query, videoType, error: (err as Error).message })
		return []
	}
}

export async function searchSongs(query: string): Promise<SongCandidate[]> {
	const [songs, videos] = await Promise.all([
		searchShelf(query, "song"),
		searchShelf(query, "video"),
	])
	return [...songs, ...videos]
}
