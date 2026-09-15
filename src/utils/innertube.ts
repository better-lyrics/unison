import { config } from "@/config"
import { Logger } from "@/infra/logger"
import { pickSquareArtwork } from "@/utils/artwork"
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

export async function getSquareArtworkUrl(
	videoId: string,
	size: number = config.artwork.size
): Promise<string | null> {
	try {
		const yt = await getInnertube()
		const info = await yt.music.getInfo(videoId)
		const thumbs = info.basic_info.thumbnail ?? []
		return pickSquareArtwork(thumbs, size)
	} catch (err) {
		log.warn("innertube artwork resolve failed", { videoId, error: (err as Error).message })
		return null
	}
}

export async function getVideoDurationSeconds(videoId: string): Promise<number | null> {
	try {
		const yt = await getInnertube()
		const info = await yt.music.getInfo(videoId)
		const duration = info.basic_info?.duration
		return typeof duration === "number" ? duration : null
	} catch (err) {
		log.warn("innertube duration resolve failed", { videoId, error: (err as Error).message })
		return null
	}
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
}

export async function searchSongs(query: string): Promise<SongCandidate[]> {
	try {
		const yt = await getInnertube()
		const res = await yt.music.search(query, { type: "all" })
		const shelves = [
			{ items: res.songs?.contents ?? [], videoType: "song" as const },
			{ items: res.videos?.contents ?? [], videoType: "video" as const },
		]
		const candidates: SongCandidate[] = []
		for (const { items, videoType } of shelves) {
			for (const it of items) {
				if (typeof it.id !== "string") continue
				const credits = it.artists ?? it.authors ?? []
				const artists = credits
					.map((a) => a.name)
					.filter((n): n is string => typeof n === "string" && n.length > 0)
				const artistChannelIds = credits
					.map((a) => a.channel_id)
					.filter((id): id is string => typeof id === "string" && id.length > 0)
				candidates.push({
					videoId: it.id,
					title: it.title ?? "",
					artist: artists[0] ?? "",
					artists,
					artistChannelIds,
					album: it.album?.name ?? null,
					durationSeconds: it.duration?.seconds ?? null,
					videoType,
				})
			}
		}
		return candidates
	} catch (err) {
		log.warn("innertube song search failed", { query, error: (err as Error).message })
		return []
	}
}
