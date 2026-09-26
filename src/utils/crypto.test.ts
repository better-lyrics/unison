import { describe, expect, it } from "vitest"
import { hashPublicKey, verifyKeyId } from "./crypto"

async function realPublicKey(): Promise<JsonWebKey> {
	const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
	const { kty, crv, x, y, key_ops, ext } = await crypto.subtle.exportKey("jwk", pair.publicKey)
	return { kty, crv, x, y, key_ops, ext }
}

describe("verifyKeyId", () => {
	it("accepts the lower-case hex hash of the public key", async () => {
		const jwk = await realPublicKey()
		expect(await verifyKeyId(await hashPublicKey(jwk), jwk)).toBe(true)
	})

	describe("regressions", () => {
		it("regression: rejects an upper-case keyId, because lookups match key_id exactly", async () => {
			const jwk = await realPublicKey()
			expect(await verifyKeyId((await hashPublicKey(jwk)).toUpperCase(), jwk)).toBe(false)
		})
	})

	describe("edge cases", () => {
		it("rejects a mixed-case keyId", async () => {
			const jwk = await realPublicKey()
			const keyId = await hashPublicKey(jwk)
			const mixed = keyId.replace(/[a-f]/, (c) => c.toUpperCase())
			expect(mixed).not.toBe(keyId)
			expect(await verifyKeyId(mixed, jwk)).toBe(false)
		})

		it("rejects the hash of a different key", async () => {
			const jwk = await realPublicKey()
			const other = await realPublicKey()
			expect(await verifyKeyId(await hashPublicKey(other), jwk)).toBe(false)
		})

		it("rejects an empty keyId", async () => {
			expect(await verifyKeyId("", await realPublicKey())).toBe(false)
		})
	})

	describe("invariants", () => {
		it("ignores optional JWK fields such as key_ops and ext", async () => {
			const jwk = await realPublicKey()
			const keyId = await hashPublicKey(jwk)
			expect(await verifyKeyId(keyId, { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y })).toBe(true)
		})
	})
})
