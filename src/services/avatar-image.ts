import { config } from "@/config"
import sharp, { type Metadata } from "sharp"

export type AvatarImageReason = "unsupported_type" | "too_large" | "decode_failed"

export class AvatarImageError extends Error {
	readonly reason: AvatarImageReason
	constructor(reason: AvatarImageReason) {
		super(reason)
		this.name = "AvatarImageError"
		this.reason = reason
	}
}

export interface FormatAvatarOptions {
	maxInputBytes?: number
	maxOutputBytes?: number
}

const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const ACCEPTED_FORMAT = new Set(["jpeg", "png", "gif", "webp"])

export async function formatAvatar(
	input: Buffer,
	mime: string,
	options: FormatAvatarOptions = {}
): Promise<{ webp: Buffer; animated: boolean }> {
	const maxInputBytes = options.maxInputBytes ?? config.avatar.maxInputBytes
	const maxOutputBytes = options.maxOutputBytes ?? config.avatar.maxOutputBytes
	const { maxInputPixels, maxPages, artworkSize } = config.avatar

	if (!ACCEPTED_MIME.has(mime)) throw new AvatarImageError("unsupported_type")
	if (input.length > maxInputBytes) throw new AvatarImageError("too_large")

	// Trust the decoded format, not the caller's mime, so SVG/TIFF labelled image/png never decode.
	let meta: Metadata
	try {
		meta = await sharp(input, { limitInputPixels: maxInputPixels }).metadata()
	} catch {
		throw new AvatarImageError("decode_failed")
	}
	if (!meta.format || !ACCEPTED_FORMAT.has(meta.format)) {
		throw new AvatarImageError("unsupported_type")
	}
	if ((meta.pages ?? 1) > maxPages) throw new AvatarImageError("too_large")

	const animated = (meta.pages ?? 1) > 1
	const { effort } = config.avatar.webp
	const steps = animated ? config.avatar.webp.animated.steps : config.avatar.webp.static.steps

	for (const quality of steps) {
		let webp: Buffer
		try {
			webp = await sharp(input, { animated, limitInputPixels: maxInputPixels })
				.resize(artworkSize, artworkSize, { fit: "cover" })
				.webp({ quality, effort })
				.toBuffer()
		} catch {
			throw new AvatarImageError("decode_failed")
		}
		if (webp.length <= maxOutputBytes) return { webp, animated }
	}

	throw new AvatarImageError("too_large")
}
