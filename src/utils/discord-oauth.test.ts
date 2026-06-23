import { describe, expect, it } from "vitest"
import { DiscordOAuthError, buildAuthorizeUrl, exchangeCodeForUser } from "./discord-oauth"

const CFG = {
	clientId: "client-123",
	clientSecret: "secret-xyz",
	redirectUri: "https://unison.boidu.dev/links/discord/callback",
}

describe("buildAuthorizeUrl", () => {
	it("builds the authorize URL with the required params", () => {
		const url = new URL(buildAuthorizeUrl(CFG, "state-abc", "identify"))
		expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize")
		expect(url.searchParams.get("client_id")).toBe("client-123")
		expect(url.searchParams.get("redirect_uri")).toBe(CFG.redirectUri)
		expect(url.searchParams.get("response_type")).toBe("code")
		expect(url.searchParams.get("scope")).toBe("identify")
		expect(url.searchParams.get("state")).toBe("state-abc")
	})
})

function fakeFetch(handlers: {
	token?: (body: string) => Response
	user?: (auth: string | null) => Response
}): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input)
		if (url.endsWith("/oauth2/token")) {
			return handlers.token?.(String(init?.body ?? "")) ?? new Response(null, { status: 500 })
		}
		if (url.endsWith("/users/@me")) {
			const auth = new Headers(init?.headers).get("authorization")
			return handlers.user?.(auth) ?? new Response(null, { status: 500 })
		}
		return new Response(null, { status: 404 })
	}) as typeof fetch
}

function ok(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	})
}

describe("exchangeCodeForUser", () => {
	it("exchanges the code and returns the Discord identity", async () => {
		let tokenBody = ""
		let sentAuth: string | null = null
		const fetchImpl = fakeFetch({
			token: (body) => {
				tokenBody = body
				return ok({ access_token: "tok-1", token_type: "Bearer" })
			},
			user: (auth) => {
				sentAuth = auth
				return ok({ id: "discord-999", username: "alice", global_name: "Alice In Wonderland" })
			},
		})

		const user = await exchangeCodeForUser(CFG, "code-1", fetchImpl)

		expect(user).toEqual({
			id: "discord-999",
			username: "alice",
			displayName: "Alice In Wonderland",
		})
		expect(tokenBody).toContain("grant_type=authorization_code")
		expect(tokenBody).toContain("code=code-1")
		expect(sentAuth).toBe("Bearer tok-1")
	})

	it("falls back to username when global_name is null", async () => {
		const fetchImpl = fakeFetch({
			token: () => ok({ access_token: "tok-2" }),
			user: () => ok({ id: "d2", username: "bob", global_name: null }),
		})
		const user = await exchangeCodeForUser(CFG, "code-2", fetchImpl)
		expect(user.displayName).toBe("bob")
	})

	describe("error paths", () => {
		it("throws when the token exchange fails", async () => {
			const fetchImpl = fakeFetch({ token: () => new Response(null, { status: 400 }) })
			await expect(exchangeCodeForUser(CFG, "bad", fetchImpl)).rejects.toBeInstanceOf(
				DiscordOAuthError
			)
		})

		it("throws when the user fetch fails", async () => {
			const fetchImpl = fakeFetch({
				token: () => ok({ access_token: "tok" }),
				user: () => new Response(null, { status: 401 }),
			})
			await expect(exchangeCodeForUser(CFG, "code", fetchImpl)).rejects.toBeInstanceOf(
				DiscordOAuthError
			)
		})

		it("throws when the user payload is missing an id", async () => {
			const fetchImpl = fakeFetch({
				token: () => ok({ access_token: "tok" }),
				user: () => ok({ username: "noid" }),
			})
			await expect(exchangeCodeForUser(CFG, "code", fetchImpl)).rejects.toBeInstanceOf(
				DiscordOAuthError
			)
		})
	})
})
