import type { Context, Next } from "hono"
import type { ApiResponse, Env } from "@/types"
import { getPublicKey, registerPublicKey } from "@/db/publicKeys"
import { getOrCreateUser } from "@/db/users"
import { verifySignature, isTimestampFresh, verifyKeyId } from "./crypto"

interface SignedRequestPayload {
	/** Unix timestamp in milliseconds (from Date.now()) */
	timestamp: number
	/** Unique nonce (min 16 chars) to prevent replay attacks */
	nonce: string
	/** SHA-256 hash of the public key */
	keyId: string
	[key: string]: unknown
}

interface SignedRequestBody {
	payload: SignedRequestPayload
	signature: string
	publicKey?: JsonWebKey
}

function isValidSignedBody(body: unknown): body is SignedRequestBody {
	if (!body || typeof body !== "object") return false
	const b = body as Record<string, unknown>

	if (!b.payload || typeof b.payload !== "object") return false
	if (typeof b.signature !== "string" || b.signature.length === 0) return false

	const p = b.payload as Record<string, unknown>
	if (typeof p.timestamp !== "number") return false
	if (typeof p.nonce !== "string" || p.nonce.length < 16) return false
	if (typeof p.keyId !== "string" || p.keyId.length !== 64) return false

	if (b.publicKey !== undefined) {
		if (typeof b.publicKey !== "object") return false
		const jwk = b.publicKey as Record<string, unknown>
		if (jwk.kty !== "EC" || jwk.crv !== "P-256") return false
		if (typeof jwk.x !== "string" || typeof jwk.y !== "string") return false
	}

	return true
}

type AuthVariables = {
	keyId: string
	userId: number
	signedPayload: SignedRequestPayload
}

export function createSignedRequestMiddleware() {
	return async (
		c: Context<{ Bindings: Env; Variables: AuthVariables }>,
		next: Next
	) => {
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json<ApiResponse>(
				{ success: false, error: "Invalid JSON" },
				400
			)
		}

		if (!isValidSignedBody(body)) {
			return c.json<ApiResponse>(
				{ success: false, error: "Invalid signed request format" },
				400
			)
		}

		const { payload, signature, publicKey } = body

		if (!isTimestampFresh(payload.timestamp)) {
			return c.json<ApiResponse>(
				{ success: false, error: "Request timestamp expired" },
				400
			)
		}

		// Check for nonce replay attacks
		const nonceKey = `nonce:${payload.keyId}:${payload.nonce}`
		const existingNonce = await c.env.CACHE.get(nonceKey)
		if (existingNonce) {
			return c.json<ApiResponse>(
				{ success: false, error: "Nonce already used" },
				400
			)
		}
		// Store nonce immediately to close the race window (TTL: 5 minutes = 300 seconds)
		await c.env.CACHE.put(nonceKey, "1", { expirationTtl: 300 })

		let keyRecord = await getPublicKey(c.env, payload.keyId)

		if (!keyRecord) {
			if (!publicKey) {
				return c.json<ApiResponse>(
					{ success: false, error: "PUBLIC_KEY_REQUIRED" },
					400
				)
			}

			if (!(await verifyKeyId(payload.keyId, publicKey))) {
				return c.json<ApiResponse>(
					{ success: false, error: "Key ID does not match public key" },
					400
				)
			}

			keyRecord = await registerPublicKey(c.env, payload.keyId, publicKey)
		}

		const storedKey = JSON.parse(keyRecord.public_key) as JsonWebKey
		if (!(await verifySignature(payload, signature, storedKey))) {
			return c.json<ApiResponse>(
				{ success: false, error: "Invalid signature" },
				403
			)
		}

		const user = await getOrCreateUser(c.env, payload.keyId)

		c.set("keyId", payload.keyId)
		c.set("userId", user.id)
		c.set("signedPayload", payload)

		await next()
	}
}
