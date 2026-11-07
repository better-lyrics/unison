import { config } from "@/config"
import { squareFromThumbnail } from "@/utils/artwork-crop"
import sharp from "sharp"
import { describe, expect, it } from "vitest"

function noise(width: number, height: number): Buffer {
	const px = Buffer.alloc(width * height * 3)
	for (let i = 0; i < px.length; i++) px[i] = 60 + ((i * 2654435761) % 180)
	return px
}

async function letterboxed(): Promise<Buffer> {
	const content = await sharp(noise(960, 300), { raw: { width: 960, height: 300, channels: 3 } })
		.png()
		.toBuffer()
	return sharp({ create: { width: 1280, height: 720, channels: 3, background: "#000" } })
		.composite([{ input: content, left: 160, top: 210 }])
		.jpeg()
		.toBuffer()
}

async function edgeBrightness(image: Buffer): Promise<number[]> {
	const { width = 0, height = 0 } = await sharp(image).metadata()
	const band = 4
	const strips = [
		{ left: 0, top: 0, width, height: band },
		{ left: 0, top: height - band, width, height: band },
		{ left: 0, top: 0, width: band, height },
		{ left: width - band, top: 0, width: band, height },
	]
	return Promise.all(
		strips.map(async (s) => {
			const { channels } = await sharp(image).extract(s).stats()
			return Math.max(...channels.slice(0, 3).map((c) => c.mean))
		})
	)
}

describe("squareFromThumbnail", () => {
	it("crops a letterboxed thumbnail to a square with no black bar on any edge", async () => {
		const square = await squareFromThumbnail(await letterboxed())
		expect(square).not.toBeNull()
		const { width, height } = await sharp(square as Buffer).metadata()
		expect(width).toBe(height)
		for (const edge of await edgeBrightness(square as Buffer)) {
			expect(edge).toBeGreaterThan(config.artwork.crop.darkEdge)
		}
	})

	it("refuses a thumbnail that is one flat colour", async () => {
		const flat = await sharp({
			create: { width: 1280, height: 720, channels: 3, background: "#5ad06a" },
		})
			.jpeg()
			.toBuffer()
		expect(await squareFromThumbnail(flat)).toBeNull()
	})
})
