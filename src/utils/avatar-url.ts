import { config } from "@/config"
import { findPreset } from "@/db/avatar-presets"

const DISCORD_CDN = "https://cdn.discordapp.com/avatars"

export function discordAvatarUrl(discordId: string, hash: string, size = 128): string {
	const ext = hash.startsWith("a_") ? "gif" : "png"
	return `${DISCORD_CDN}/${discordId}/${hash}.${ext}?size=${size}`
}

export interface AvatarChoice {
	avatarType: string | null
	avatarRef: string | null
	discordId: string | null
	discordAvatar: string | null
}

export function avatarUrlFor(choice: AvatarChoice): string | null {
	if (choice.avatarType === "preset") {
		const preset = choice.avatarRef ? findPreset(choice.avatarRef) : undefined
		return preset ? config.avatar.cdnBase + preset.file : null
	}
	if (choice.avatarType === "discord") {
		if (!choice.discordId || !choice.discordAvatar) return null
		return discordAvatarUrl(choice.discordId, choice.discordAvatar)
	}
	return null
}
