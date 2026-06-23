const DISCORD_API = "https://discord.com/api/v10"
const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize"

export interface DiscordOAuthConfig {
	clientId: string
	clientSecret: string
	redirectUri: string
}

export interface DiscordIdentity {
	id: string
	username: string
	displayName: string
}

export class DiscordOAuthError extends Error {
	constructor(public reason: string) {
		super(`discord oauth failed: ${reason}`)
		this.name = "DiscordOAuthError"
	}
}

export function buildAuthorizeUrl(
	cfg: Pick<DiscordOAuthConfig, "clientId" | "redirectUri">,
	state: string,
	scope: string
): string {
	const params = new URLSearchParams({
		client_id: cfg.clientId,
		redirect_uri: cfg.redirectUri,
		response_type: "code",
		scope,
		state,
		prompt: "consent",
	})
	return `${DISCORD_AUTHORIZE}?${params.toString()}`
}

export async function exchangeCodeForUser(
	cfg: DiscordOAuthConfig,
	code: string,
	fetchImpl: typeof fetch = fetch
): Promise<DiscordIdentity> {
	const tokenRes = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: cfg.redirectUri,
			client_id: cfg.clientId,
			client_secret: cfg.clientSecret,
		}).toString(),
	})
	if (!tokenRes.ok) throw new DiscordOAuthError("token_exchange_failed")

	const token = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null
	if (!token?.access_token) throw new DiscordOAuthError("no_access_token")

	const userRes = await fetchImpl(`${DISCORD_API}/users/@me`, {
		headers: { authorization: `Bearer ${token.access_token}` },
	})
	if (!userRes.ok) throw new DiscordOAuthError("user_fetch_failed")

	const user = (await userRes.json().catch(() => null)) as {
		id?: string
		username?: string
		global_name?: string | null
	} | null
	if (!user?.id || !user.username) throw new DiscordOAuthError("invalid_user")

	return { id: user.id, username: user.username, displayName: user.global_name || user.username }
}
