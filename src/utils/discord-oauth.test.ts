import { describe, expect, it } from "vitest"
import {
	DiscordOAuthError,
	buildAuthorizeUrl,
	exchangeCodeForUser,
	sanitizeDiscordAvatarHash,
} from "./discord-oauth"

const HASH = "8342729096ea3675442027381ff50dfe"

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
			avatar: null,
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

	it("captures the avatar hash from the user payload", async () => {
		const fetchImpl = fakeFetch({
			token: () => ok({ access_token: "tok" }),
			user: () => ok({ id: "d3", username: "carol", global_name: "Carol", avatar: HASH }),
		})
		const user = await exchangeCodeForUser(CFG, "code-3", fetchImpl)
		expect(user.avatar).toBe(HASH)
	})

	it("keeps an animated avatar hash verbatim", async () => {
		const fetchImpl = fakeFetch({
			token: () => ok({ access_token: "tok" }),
			user: () => ok({ id: "d5", username: "erin", global_name: null, avatar: `a_${HASH}` }),
		})
		const user = await exchangeCodeForUser(CFG, "code-5", fetchImpl)
		expect(user.avatar).toBe(`a_${HASH}`)
	})

	it("drops an avatar value that is not a Discord image hash", async () => {
		const fetchImpl = fakeFetch({
			token: () => ok({ access_token: "tok" }),
			user: () => ok({ id: "d6", username: "mal", avatar: "../../evil?x=" }),
		})
		const user = await exchangeCodeForUser(CFG, "code-6", fetchImpl)
		expect(user.avatar).toBeNull()
	})

	it("returns a null avatar when the user has no custom avatar", async () => {
		const fetchImpl = fakeFetch({
			token: () => ok({ access_token: "tok" }),
			user: () => ok({ id: "d4", username: "dave", global_name: null, avatar: null }),
		})
		const user = await exchangeCodeForUser(CFG, "code-4", fetchImpl)
		expect(user.avatar).toBeNull()
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

describe("sanitizeDiscordAvatarHash", () => {
	it("keeps a static avatar hash", () => {
		expect(sanitizeDiscordAvatarHash(HASH)).toBe(HASH)
	})

	it("keeps an animated avatar hash", () => {
		expect(sanitizeDiscordAvatarHash(`a_${HASH}`)).toBe(`a_${HASH}`)
	})

	describe("edge cases", () => {
		it("returns null for null", () => {
			expect(sanitizeDiscordAvatarHash(null)).toBeNull()
		})

		it("returns null for an empty string", () => {
			expect(sanitizeDiscordAvatarHash("")).toBeNull()
		})

		it("rejects uppercase hex", () => {
			expect(sanitizeDiscordAvatarHash(HASH.toUpperCase())).toBeNull()
		})

		it("rejects a hash one character short or long", () => {
			expect(sanitizeDiscordAvatarHash(HASH.slice(1))).toBeNull()
			expect(sanitizeDiscordAvatarHash(`${HASH}0`)).toBeNull()
		})

		it("rejects surrounding whitespace", () => {
			expect(sanitizeDiscordAvatarHash(` ${HASH}`)).toBeNull()
		})
	})

	describe("error paths", () => {
		it("rejects a path traversal payload", () => {
			expect(sanitizeDiscordAvatarHash("../../evil?x=")).toBeNull()
		})

		it("rejects a hash with an unknown prefix", () => {
			expect(sanitizeDiscordAvatarHash(`b_${HASH}`)).toBeNull()
		})
	})
})
