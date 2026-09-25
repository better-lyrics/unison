import type { Env } from "@/types"

export interface DiscordLink {
	discord_id: string
	key_id: string
	discord_username: string | null
	discord_avatar: string | null
	linked_at: number
}

export async function getByDiscordId(env: Env, discordId: string): Promise<DiscordLink | null> {
	return env.DB.prepare("SELECT * FROM discord_links WHERE discord_id = ?")
		.bind(discordId)
		.first<DiscordLink>()
}

export async function getByKeyId(env: Env, keyId: string): Promise<DiscordLink | null> {
	return env.DB.prepare("SELECT * FROM discord_links WHERE key_id = ?")
		.bind(keyId)
		.first<DiscordLink>()
}

export async function linkDiscord(
	env: Env,
	params: {
		discordId: string
		keyId: string
		discordUsername: string | null
		discordAvatar: string | null
	}
): Promise<void> {
	const now = Math.floor(Date.now() / 1000)
	await env.DB.batch([
		env.DB.prepare("DELETE FROM discord_links WHERE key_id = ? OR discord_id = ?").bind(
			params.keyId,
			params.discordId
		),
		env.DB.prepare(
			"INSERT INTO discord_links (discord_id, key_id, discord_username, discord_avatar, linked_at) VALUES (?, ?, ?, ?, ?)"
		).bind(params.discordId, params.keyId, params.discordUsername, params.discordAvatar, now),
	])
}

export async function updateDiscordAvatar(
	env: Env,
	params: { keyId: string; discordId: string; discordAvatar: string | null }
): Promise<void> {
	await env.DB.prepare(
		"UPDATE discord_links SET discord_avatar = ? WHERE key_id = ? AND discord_id = ?"
	)
		.bind(params.discordAvatar, params.keyId, params.discordId)
		.run()
}

export async function unlinkByKeyId(env: Env, keyId: string): Promise<void> {
	await env.DB.prepare("DELETE FROM discord_links WHERE key_id = ?").bind(keyId).run()
}

export async function listLinks(env: Env): Promise<Pick<DiscordLink, "discord_id" | "key_id">[]> {
	const { results } = await env.DB.prepare("SELECT discord_id, key_id FROM discord_links")
		.bind()
		.all<Pick<DiscordLink, "discord_id" | "key_id">>()
	return results
}
