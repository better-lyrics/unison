import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { isAuthorizedAdmin } from "./admin-auth"

function env(adminSecret: string | null | undefined): Env {
	return { ADMIN_SECRET: adminSecret } as unknown as Env
}

describe("isAuthorizedAdmin", () => {
	it("rejects when ADMIN_SECRET is unset (deploy-dark default)", () => {
		expect(isAuthorizedAdmin("Bearer anything", env(null))).toBe(false)
		expect(isAuthorizedAdmin("Bearer anything", env(undefined))).toBe(false)
	})

	it("rejects a missing or malformed authorization header", () => {
		expect(isAuthorizedAdmin(undefined, env("s3cret"))).toBe(false)
		expect(isAuthorizedAdmin("s3cret", env("s3cret"))).toBe(false)
		expect(isAuthorizedAdmin("Bearer ", env("s3cret"))).toBe(false)
	})

	it("rejects a wrong secret", () => {
		expect(isAuthorizedAdmin("Bearer wrong", env("s3cret"))).toBe(false)
	})

	it("accepts the correct bearer secret", () => {
		expect(isAuthorizedAdmin("Bearer s3cret", env("s3cret"))).toBe(true)
	})

	it("does not accept the butler bot secret (separate blast radius)", () => {
		const mixed = {
			ADMIN_SECRET: "admin-secret",
			BUTLER_BOT_SECRET: "bot-secret",
		} as unknown as Env
		expect(isAuthorizedAdmin("Bearer bot-secret", mixed)).toBe(false)
	})
})
