import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { isAuthorizedBot } from "./bot-auth"

function envWith(secret: string | null): Env {
	return { BUTLER_BOT_SECRET: secret } as unknown as Env
}

describe("isAuthorizedBot", () => {
	it("accepts the correct bearer secret", () => {
		expect(isAuthorizedBot("Bearer s3cret", envWith("s3cret"))).toBe(true)
	})

	describe("rejections", () => {
		it("rejects a wrong secret", () => {
			expect(isAuthorizedBot("Bearer nope", envWith("s3cret"))).toBe(false)
		})

		it("rejects a missing header", () => {
			expect(isAuthorizedBot(undefined, envWith("s3cret"))).toBe(false)
		})

		it("rejects a non-bearer header", () => {
			expect(isAuthorizedBot("s3cret", envWith("s3cret"))).toBe(false)
		})

		it("rejects when no secret is configured", () => {
			expect(isAuthorizedBot("Bearer anything", envWith(null))).toBe(false)
		})

		it("rejects a secret of a different length without throwing", () => {
			expect(isAuthorizedBot("Bearer short", envWith("a-much-longer-secret"))).toBe(false)
		})
	})
})
