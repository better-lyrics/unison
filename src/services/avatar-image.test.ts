import { readFileSync } from "node:fs"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { formatAvatar } from "./avatar-image"

const animGif = readFileSync(new URL("./__fixtures__/anim.gif", import.meta.url))

async function makeNoisyPng(size = 256): Promise<Buffer> {
	const raw = Buffer.alloc(size * size * 3)
	for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
	return sharp(raw, { raw: { width: size, height: size, channels: 3 } })
		.png()
		.toBuffer()
}

describe("formatAvatar", () => {
	it("returns a 256x256 webp for a static image, not animated", async () => {
		const png = await makeNoisyPng()
		const { webp, animated } = await formatAvatar(png, "image/png")
		expect(animated).toBe(false)
		const meta = await sharp(webp).metadata()
		expect(meta.format).toBe("webp")
		expect(meta.width).toBe(256)
		expect(meta.height).toBe(256)
	})

	it("preserves animation for a gif and outputs a 256x256 webp", async () => {
		const { webp, animated } = await formatAvatar(animGif, "image/gif")
		expect(animated).toBe(true)
		const meta = await sharp(webp, { animated: true }).metadata()
		expect(meta.format).toBe("webp")
		expect(meta.width).toBe(256)
		expect(meta.pageHeight).toBe(256)
		expect(meta.pages).toBe(4)
	})

	describe("edge cases", () => {
		it("rejects an unsupported mime", async () => {
			await expect(formatAvatar(Buffer.from("x"), "image/svg+xml")).rejects.toMatchObject({
				reason: "unsupported_type",
			})
		})

		it("rejects input over the size limit", async () => {
			const big = Buffer.alloc(9 * 1024 * 1024)
			await expect(formatAvatar(big, "image/png")).rejects.toMatchObject({
				reason: "too_large",
			})
		})

		it("rejects an undecodable buffer", async () => {
			await expect(formatAvatar(Buffer.from("not an image"), "image/png")).rejects.toMatchObject({
				reason: "decode_failed",
			})
		})

		it("rejects bytes whose real format is not allowed even if the mime is spoofed", async () => {
			const svg = Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>'
			)
			await expect(formatAvatar(svg, "image/png")).rejects.toMatchObject({
				reason: "unsupported_type",
			})
		})
	})

	describe("size budget", () => {
		it("steps quality down to fit a tighter byte budget", async () => {
			const png = await makeNoisyPng()
			const full = await formatAvatar(png, "image/png")
			const budget = full.webp.length - 1
			const stepped = await formatAvatar(png, "image/png", { maxOutputBytes: budget })
			expect(stepped.webp.length).toBeLessThanOrEqual(budget)
		})

		it("throws too_large when even the lowest quality exceeds the budget", async () => {
			const png = await makeNoisyPng()
			await expect(formatAvatar(png, "image/png", { maxOutputBytes: 1 })).rejects.toMatchObject({
				reason: "too_large",
			})
		})
	})
})
