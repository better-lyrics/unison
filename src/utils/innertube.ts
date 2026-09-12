import { Innertube } from "youtubei.js"
import { config } from "@/config"
import { Logger } from "@/infra/logger"
import { pickSquareArtwork } from "@/utils/artwork"

const log = new Logger("innertube")
let client: Promise<Innertube> | null = null

function getInnertube(): Promise<Innertube> {
	if (!client) client = Innertube.create({ retrieve_player: false })
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
