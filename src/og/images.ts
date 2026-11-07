import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { log } from "@/infra/logger"
import { fetchArtworkImage, resolveArtwork } from "@/services/artwork"
import type { Env } from "@/types"
import { type Accent, accentFromPixels } from "@/utils/accent"
import { normalizeArtworkUrl } from "@/utils/artwork"
import { sleeveCss } from "@/utils/sleeve"
import { createAvatar } from "@dicebear/core"
import * as thumbs from "@dicebear/thumbs"
import sharp from "sharp"
import { render } from "takumi-js"
import { container } from "takumi-js/helpers"

const FETCH_TIMEOUT_MS = 3000
const COVER_SIZE = 1024
const AVATAR_SIZE = 384
const BACKED_SIZE = 256
const KAWARP_SOURCE = 128
const WASH = { warpIntensity: 0.9, blurPasses: 8, saturation: 1.5, dithering: 0.08 }
const BADGE_DIR = fileURLToPath(new URL("../../assets/badges/", import.meta.url))
const SILHOUETTE_TINT = { r: 10, g: 9, b: 13, alpha: 0.2 }
const SILHOUETTE_SIZE = 96
const SLEEVE_SIZE = 630

async function fetchBytes(url: string): Promise<Buffer | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
		if (!res.ok) {
			log.warn("og image fetch rejected", { url, status: res.status })
			return null
		}
		return Buffer.from(await res.arrayBuffer())
	} catch (error) {
		log.warn("og image fetch failed", { url, error: (error as Error).message })
		return null
	}
}

export async function coverFromUrl(url: string, size = COVER_SIZE): Promise<Buffer | null> {
	return (await fetchArtworkImage(url, size))?.bytes ?? null
}

export async function coverBytes(
	env: Env,
	videoId: string,
	size = COVER_SIZE
): Promise<Buffer | null> {
	const url = await resolveArtwork(env, videoId)
	return url ? coverFromUrl(url, size) : null
}

export function generatedAvatarSvg(seed: string): string {
	return createAvatar(thumbs, { seed, radius: 50 }).toString()
}

export async function avatarBytes(url: string | null, seed: string): Promise<Buffer> {
	const fetched = url ? await fetchBytes(url) : null
	const source = fetched ?? Buffer.from(generatedAvatarSvg(seed))
	try {
		return await sharp(source, { animated: false })
			.resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
			.png()
			.toBuffer()
	} catch (error) {
		log.warn("og avatar decode failed", { url, error: (error as Error).message })
		return sharp(Buffer.from(generatedAvatarSvg(seed)))
			.resize(AVATAR_SIZE)
			.png()
			.toBuffer()
	}
}

export async function sample32(bytes: Buffer): Promise<Uint8Array> {
	return sharp(bytes).resize(32, 32, { fit: "fill" }).ensureAlpha().raw().toBuffer()
}

export async function sampleAccent(bytes: Buffer): Promise<Accent> {
	return accentFromPixels(await sample32(bytes))
}

export async function backedImage(bytes: Buffer, accent: Accent): Promise<Buffer> {
	if (accent.clear < 0.15) return bytes
	const face = await sharp(bytes).resize(BACKED_SIZE, BACKED_SIZE, { fit: "fill" }).png().toBuffer()
	return sharp({
		create: {
			width: BACKED_SIZE,
			height: BACKED_SIZE,
			channels: 4,
			background: `hsl(${accent.hue}, 45%, 34%)`,
		},
	})
		.composite([{ input: face }])
		.png()
		.toBuffer()
}

export async function washFrom(bytes: Buffer, width: number, height: number): Promise<Buffer> {
	const rgba = await sharp(bytes)
		.resize(KAWARP_SOURCE, KAWARP_SOURCE, { fit: "fill" })
		.ensureAlpha()
		.raw()
		.toBuffer()
	const { frame } = await import("@kawarp/core/frame")
	const pixels = frame(rgba, KAWARP_SOURCE, KAWARP_SOURCE, width, height, WASH)
	return sharp(pixels, { raw: { width, height, channels: 4 } })
		.png()
		.toBuffer()
}

export async function sleeveBytes(song: string, artist: string): Promise<Buffer> {
	const node = container({
		style: { width: "100%", height: "100%", backgroundImage: sleeveCss(song, artist) },
	})
	return Buffer.from(await render(node, { width: SLEEVE_SIZE, height: SLEEVE_SIZE, format: "png" }))
}

export async function fingerprint(bytes: Buffer): Promise<string> {
	const raw = await sharp(bytes).resize(8, 8, { fit: "fill" }).removeAlpha().raw().toBuffer()
	return raw.toString("hex")
}

const assets = new Map<string, Promise<Buffer | null>>()

function cachedAsset(key: string, load: () => Promise<Buffer>): Promise<Buffer | null> {
	let pending = assets.get(key)
	if (!pending) {
		pending = load().catch((error: unknown) => {
			log.warn("og asset failed", { key, error: (error as Error).message })
			assets.delete(key)
			return null
		})
		assets.set(key, pending)
	}
	return pending
}

export function badgeArt(file: string): Promise<Buffer | null> {
	return cachedAsset(`badge:${file}`, () => readFile(`${BADGE_DIR}${file}`))
}

export function badgeSilhouette(file: string): Promise<Buffer | null> {
	return cachedAsset(`silhouette:${file}`, async () => {
		const svg = await readFile(`${BADGE_DIR}${file}`)
		const alpha = await sharp(svg, { density: 288 })
			.resize(SILHOUETTE_SIZE, SILHOUETTE_SIZE, { fit: "contain", background: "#0000" })
			.ensureAlpha()
			.extractChannel(3)
			.raw()
			.toBuffer()
		for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round(alpha[i] * SILHOUETTE_TINT.alpha)
		const { r, g, b } = SILHOUETTE_TINT
		return sharp({
			create: {
				width: SILHOUETTE_SIZE,
				height: SILHOUETTE_SIZE,
				channels: 3,
				background: { r, g, b },
			},
		})
			.joinChannel(alpha, { raw: { width: SILHOUETTE_SIZE, height: SILHOUETTE_SIZE, channels: 1 } })
			.png()
			.toBuffer()
	})
}
