import { config } from "@/config"
import sharp from "sharp"

const { crop } = config.artwork

async function darkEdge(image: Buffer, side: number): Promise<boolean> {
	const band = Math.max(4, Math.round(side * 0.03))
	const strips = [
		{ left: 0, top: 0, width: side, height: band },
		{ left: 0, top: side - band, width: side, height: band },
		{ left: 0, top: 0, width: band, height: side },
		{ left: side - band, top: 0, width: band, height: side },
	]
	for (const strip of strips) {
		const { channels } = await sharp(image).extract(strip).stats()
		if (Math.max(...channels.slice(0, 3).map((c) => c.mean)) < crop.darkEdge) return true
	}
	return false
}

/** A centre square from a video thumbnail with its black borders cut away, or null when no clean square exists. */
export async function squareFromThumbnail(thumbnail: Buffer): Promise<Buffer | null> {
	const trimmed = await sharp(thumbnail)
		.trim({ background: "#000000", threshold: crop.trimThreshold })
		.toBuffer({ resolveWithObject: true })
	const dx = Math.round(trimmed.info.width * crop.inset)
	const dy = Math.round(trimmed.info.height * crop.inset)
	const width = trimmed.info.width - 2 * dx
	const height = trimmed.info.height - 2 * dy
	const side = Math.min(width, height, crop.maxSide)
	if (Math.min(width, height) < crop.minSide) return null

	const square = await sharp(trimmed.data)
		.extract({ left: dx, top: dy, width, height })
		.resize(side, side, { fit: "cover", position: "centre" })
		.jpeg({ quality: 85 })
		.toBuffer()

	const { channels } = await sharp(square).stats()
	if (channels.slice(0, 3).every((c) => c.stdev < crop.flatStdev)) return null
	if (await darkEdge(square, side)) return null
	return square
}
