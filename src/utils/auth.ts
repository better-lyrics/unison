import { Elysia } from "elysia"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"
import { getPublicKey, registerPublicKey } from "@/db/publicKeys"
import { getOrCreateUser } from "@/db/users"
import { verifySignature, isTimestampFresh, verifyKeyId } from "./crypto"

const log = new Logger("auth")

interface SignedRequestPayload {
	timestamp: number
	nonce: string
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

export const signedRequest = new Elysia({ name: "signed-request" }).derive(
	{ as: "scoped" },
	async (ctx) => {
		const body = ctx.body
		const env = (ctx as unknown as { env: Env }).env

		if (!isValidSignedBody(body)) {
			log.warn("invalid signed request format")
			throw new Error("Invalid signed request format")
		}

		const { payload, signature, publicKey } = body

		if (!isTimestampFresh(payload.timestamp)) {
			log.warn("expired timestamp", { keyId: payload.keyId })
			throw new Error("Request timestamp expired")
		}

		const nonceKey = `nonce:${payload.keyId}:${payload.nonce}`
		const claimed = await env.CACHE.setNX(nonceKey, "1", 300)
		if (!claimed) {
			log.warn("nonce replay attempt", { keyId: payload.keyId })
			throw new Error("Nonce already used")
		}

		let keyRecord = await getPublicKey(env, payload.keyId)

		if (!keyRecord) {
			if (!publicKey) {
				log.info("new key requires registration", { keyId: payload.keyId })
				throw new Error("PUBLIC_KEY_REQUIRED")
			}

			if (!(await verifyKeyId(payload.keyId, publicKey))) {
				log.warn("key ID mismatch", { keyId: payload.keyId })
				throw new Error("Key ID does not match public key")
			}

			keyRecord = await registerPublicKey(env, payload.keyId, publicKey)
			log.info("new public key registered", { keyId: payload.keyId })
		}

		const storedKey = JSON.parse(keyRecord.public_key) as JsonWebKey
		if (!(await verifySignature(payload, signature, storedKey))) {
			log.warn("invalid signature", { keyId: payload.keyId })
			throw new Error("Invalid signature")
		}

		const user = await getOrCreateUser(env, payload.keyId)
		log.debug("authenticated", { keyId: payload.keyId, userId: user.id })

		return {
			keyId: payload.keyId,
			userId: user.id,
			signedPayload: payload as Record<string, unknown>,
		}
	}
)
