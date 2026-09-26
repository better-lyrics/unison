import { config } from "@/config"
import sharp from "sharp"

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

export async function formatAvatar(
	input: Buffer,
	mime: string,
	options: FormatAvatarOptions = {}
): Promise<{ webp: Buffer; animated: boolean }> {
	const maxInputBytes = options.maxInputBytes ?? config.avatar.maxInputBytes
	const maxOutputBytes = options.maxOutputBytes ?? config.avatar.maxOutputBytes

	if (!ACCEPTED_MIME.has(mime)) throw new AvatarImageError("unsupported_type")
	if (input.length > maxInputBytes) throw new AvatarImageError("too_large")

	const animated = mime === "image/gif" || mime === "image/webp"
	const { effort } = config.avatar.webp
	const steps = animated ? config.avatar.webp.animated.steps : config.avatar.webp.static.steps

	for (const quality of steps) {
		let webp: Buffer
		try {
			webp = await sharp(input, { animated })
				.resize(256, 256, { fit: "cover" })
				.webp({ quality, effort })
				.toBuffer()
		} catch {
			throw new AvatarImageError("decode_failed")
		}
		if (webp.length <= maxOutputBytes) return { webp, animated }
	}

	throw new AvatarImageError("too_large")
}
