import { Elysia, status } from "elysia"
import { getPublicKey, registerPublicKey } from "@/db/publicKeys"
import { getOrCreateUser } from "@/db/users"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"
import { isTimestampFresh, verifyKeyId, verifySignature } from "@/utils/crypto"
import { buildError, ErrorCode } from "@/utils/errors"
import { getSession } from "@/utils/session"

const log = new Logger("either-auth")

interface SignedPayload {
	timestamp: number
	nonce: string
	keyId: string
	[key: string]: unknown
}

interface SignedBody {
	payload: SignedPayload
	signature: string
	publicKey?: JsonWebKey
}

const SIGNED_PAYLOAD_RESERVED = new Set(["timestamp", "nonce", "keyId"])

function extractBearer(header: string | undefined): string | null {
	if (!header || !header.startsWith("Bearer ")) return null
	const token = header.slice(7).trim()
	return token.length > 0 ? token : null
}

function isValidSignedBody(body: unknown): body is SignedBody {
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

function liftActionFields(payload: SignedPayload): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const key of Object.keys(payload)) {
		if (!SIGNED_PAYLOAD_RESERVED.has(key)) {
			out[key] = payload[key]
		}
	}
	return out
}

export const eitherAuth = new Elysia({ name: "either-auth" }).derive(
	{ as: "scoped" },
	async (ctx) => {
		const env = (ctx as unknown as { env: Env }).env
		const bearer = extractBearer(ctx.headers.authorization)

		if (bearer !== null) {
			const record = await getSession(env, bearer)
			if (!record) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}
			const user = await getOrCreateUser(env, record.keyId)
			log.debug("bearer authenticated", { keyId: record.keyId, userId: user.id })
			return {
				keyId: record.keyId,
				userId: user.id,
				body: (ctx.body ?? {}) as Record<string, unknown>,
			}
		}

		const rawBody = ctx.body
		if (!isValidSignedBody(rawBody)) {
			log.warn("invalid signed request format")
			return status(400, buildError(ErrorCode.INVALID_SIGNED_BODY))
		}

		const { payload, signature, publicKey } = rawBody

		if (!isTimestampFresh(payload.timestamp)) {
			log.warn("expired timestamp", { keyId: payload.keyId })
			return status(401, buildError(ErrorCode.TIMESTAMP_EXPIRED))
		}

		const nonceKey = `nonce:${payload.keyId}:${payload.nonce}`
		const claimed = await env.CACHE.setNX(nonceKey, "1", 300)
		if (!claimed) {
			log.warn("nonce replay attempt", { keyId: payload.keyId })
			return status(409, buildError(ErrorCode.NONCE_REPLAY))
		}

		let keyRecord = await getPublicKey(env, payload.keyId)

		if (!keyRecord) {
			if (!publicKey) {
				log.info("new key requires registration", { keyId: payload.keyId })
				return status(400, buildError(ErrorCode.PUBLIC_KEY_REQUIRED))
			}
			if (!(await verifyKeyId(payload.keyId, publicKey))) {
				log.warn("key ID mismatch", { keyId: payload.keyId })
				return status(403, buildError(ErrorCode.KEY_ID_MISMATCH))
			}
			keyRecord = await registerPublicKey(env, payload.keyId, publicKey)
			log.info("new public key registered", { keyId: payload.keyId })
		}

		const storedKey = JSON.parse(keyRecord.public_key) as JsonWebKey
		if (!(await verifySignature(payload, signature, storedKey))) {
			log.warn("invalid signature", { keyId: payload.keyId })
			return status(401, buildError(ErrorCode.INVALID_SIGNATURE))
		}

		const user = await getOrCreateUser(env, payload.keyId)
		log.debug("authenticated", { keyId: payload.keyId, userId: user.id })
		return {
			keyId: payload.keyId,
			userId: user.id,
			body: liftActionFields(payload),
		}
	}
)
