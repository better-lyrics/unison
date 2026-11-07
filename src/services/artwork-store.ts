import { createHash } from "node:crypto"
import { config } from "@/config"
import type { Env } from "@/types"
import sharp from "sharp"

export interface ArtworkImage {
	bytes: Buffer
	type: string
}

export async function fetchImage(url: string): Promise<ArtworkImage | null> {
	const res = await fetch(url, { signal: AbortSignal.timeout(config.artwork.fetchTimeoutMs) })
	if (res.status === 404) return null
	if (!res.ok) throw new Error(`image ${url} answered ${res.status}`)
	const type = res.headers.get("content-type") ?? ""
	if (!type.startsWith("image/")) throw new Error(`image ${url} is ${type || "untyped"}`)
	if (Number(res.headers.get("content-length")) > config.artwork.maxImageBytes) {
		throw new Error(`image ${url} is too large`)
	}
	const bytes = Buffer.from(await res.arrayBuffer())
	if (bytes.length > config.artwork.maxImageBytes) throw new Error(`image ${url} is too large`)
	return { bytes, type }
}

export interface MirroredImage {
	url: string
	bytes: number
}

export async function mirrorImage(
	env: Env,
	videoId: string,
	image: Buffer
): Promise<MirroredImage> {
	if (!env.CDN) throw new Error("artwork CDN is not configured")
	const side = config.artwork.size
	const jpeg = await sharp(image)
		.resize(side, side, { fit: "cover", withoutEnlargement: true })
		.jpeg({ quality: 85 })
		.toBuffer()
	const hash = createHash("sha256").update(jpeg).digest("hex").slice(0, 16)
	const file = `${videoId}-${hash}.jpg`
	await env.CDN.putObject(
		config.artwork.cdnKeyPrefix + file,
		jpeg,
		"image/jpeg",
		jpeg.length,
		config.artwork.cdnCacheControl
	)
	return { url: config.artwork.cdnBase + file, bytes: jpeg.length }
}

export async function deleteMirroredImage(env: Env, url: string): Promise<void> {
	if (!env.CDN) throw new Error("artwork CDN is not configured")
	await env.CDN.deleteObject(url.replace(config.artwork.cdnBase, config.artwork.cdnKeyPrefix))
}
