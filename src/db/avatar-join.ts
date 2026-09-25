import { avatarUrlFor } from "@/utils/avatar-url"

export const AVATAR_COLUMNS =
	"u.avatar_type, u.avatar_ref, dl.discord_id, dl.discord_avatar, sa.artwork_url AS avatar_artwork_url"

export const AVATAR_JOINS = `LEFT JOIN discord_links dl ON dl.key_id = u.key_id
		 LEFT JOIN song_artwork sa ON u.avatar_type = 'song' AND sa.video_id = u.avatar_ref`

export interface AvatarRow {
	avatar_type: string | null
	avatar_ref: string | null
	discord_id: string | null
	discord_avatar: string | null
	avatar_artwork_url: string | null
}

export function avatarUrlForRow(row: AvatarRow): string | null {
	return avatarUrlFor({
		avatarType: row.avatar_type,
		avatarRef: row.avatar_ref,
		discordId: row.discord_id,
		discordAvatar: row.discord_avatar,
		artworkUrl: row.avatar_artwork_url,
	})
}
