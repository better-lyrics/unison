import type { DiscordLink } from "@/db/discordLinks"
import { resolveArtwork } from "@/services/artwork"
import type { Env } from "@/types"

export interface ProfileSettingsChange {
	banner?: string | null
	showDiscord?: boolean
}

export interface ProfileExtras {
	banner?: { videoId: string; artworkUrl: string }
	discord?: { id: string; username: string }
}

interface SettingsRow {
	banner_video_id: string | null
	banner_live: boolean
	show_discord: boolean
}

export async function setProfileSettings(
	env: Env,
	keyId: string,
	change: ProfileSettingsChange
): Promise<{ banner: string | null; showDiscord: boolean } | null> {
	const row = await env.DB.prepare(
		`UPDATE users SET
			banner_video_id = CASE WHEN ? THEN ? ELSE banner_video_id END,
			show_discord = COALESCE(?, show_discord)
		 WHERE key_id = ?
		 RETURNING banner_video_id, show_discord`
	)
		.bind(
			change.banner !== undefined,
			change.banner ?? null,
			change.showDiscord ?? null,
			keyId
		)
		.first<{ banner_video_id: string | null; show_discord: boolean }>()
	return row ? { banner: row.banner_video_id, showDiscord: row.show_discord } : null
}

export async function getProfileExtras(
	env: Env,
	keyId: string,
	link: DiscordLink | null
): Promise<ProfileExtras> {
	const row = await env.DB.prepare(
		`SELECT u.banner_video_id, u.show_discord,
			EXISTS (
				SELECT 1 FROM lyrics l
				WHERE l.submitter_id = u.id AND l.video_id = u.banner_video_id AND l.deleted_at IS NULL
			) AS banner_live
		 FROM users u WHERE u.key_id = ?`
	)
		.bind(keyId)
		.first<SettingsRow>()
	if (!row) return {}
	const extras: ProfileExtras = {}
	if (row.banner_video_id && row.banner_live) {
		const artworkUrl = await resolveArtwork(env, row.banner_video_id)
		if (artworkUrl) extras.banner = { videoId: row.banner_video_id, artworkUrl }
	}
	if (row.show_discord && link?.discord_username) {
		extras.discord = { id: link.discord_id, username: link.discord_username }
	}
	return extras
}
