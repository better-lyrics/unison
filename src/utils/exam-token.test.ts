import { describe, expect, it } from "vitest"
import { generateExamToken, hashExamToken } from "./exam-token"

describe("generateExamToken", () => {
	it("produces URL-safe tokens", () => {
		expect(generateExamToken()).toMatch(/^[A-Za-z0-9_-]+$/)
	})

	it("produces a fresh token each call", () => {
		expect(generateExamToken()).not.toBe(generateExamToken())
	})
})

describe("hashExamToken", () => {
	it("returns a 64-char lowercase hex sha-256", async () => {
		const hash = await hashExamToken("some-token")
		expect(hash).toMatch(/^[0-9a-f]{64}$/)
	})

	it("is deterministic for the same token", async () => {
		expect(await hashExamToken("abc")).toBe(await hashExamToken("abc"))
	})

	it("separates distinct tokens", async () => {
		expect(await hashExamToken("abc")).not.toBe(await hashExamToken("abd"))
	})
})
