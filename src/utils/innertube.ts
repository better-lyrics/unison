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
	album: string | null
	durationSeconds: number | null
}

export async function searchSongs(query: string): Promise<SongCandidate[]> {
	try {
		const yt = await getInnertube()
		const res = await yt.music.search(query, { type: "song" })
		const items = res.songs?.contents ?? []
		const candidates: SongCandidate[] = []
		for (const it of items) {
			if (typeof it.id !== "string") continue
			candidates.push({
				videoId: it.id,
				title: it.title ?? "",
				artist: it.artists?.[0]?.name ?? "",
				album: it.album?.name ?? null,
				durationSeconds: it.duration?.seconds ?? null,
			})
		}
		return candidates
	} catch (err) {
		log.warn("innertube song search failed", { query, error: (err as Error).message })
		return []
	}
}
