const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000
const ECDSA_PARAMS = { name: "ECDSA", namedCurve: "P-256" } as const
const ECDSA_SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const

export async function verifySignature(
	payload: object,
	signature: string,
	publicKeyJwk: JsonWebKey
): Promise<boolean> {
	try {
		const key = await crypto.subtle.importKey(
			"jwk",
			publicKeyJwk,
			ECDSA_PARAMS,
			false,
			["verify"]
		)

		const signatureBuffer = base64ToBuffer(signature)
		const payloadBuffer = new TextEncoder().encode(canonicalJson(payload))

		return await crypto.subtle.verify(
			ECDSA_SIGN_PARAMS,
			key,
			signatureBuffer,
			payloadBuffer
		)
	} catch {
		return false
	}
}

/**
 * Checks if a timestamp is within the acceptable freshness window.
 * @param timestamp - Unix timestamp in milliseconds (from Date.now())
 * @returns true if the timestamp is within ±5 minutes of the current time
 */
export function isTimestampFresh(timestamp: number): boolean {
	const now = Date.now()
	const diff = Math.abs(now - timestamp)
	return diff <= TIMESTAMP_TOLERANCE_MS
}

export async function hashPublicKey(publicKeyJwk: JsonWebKey): Promise<string> {
	// Normalize: only include fields that define the EC key identity
	// This ensures the same key produces the same hash regardless of optional fields
	const normalized = {
		crv: publicKeyJwk.crv,
		kty: publicKeyJwk.kty,
		x: publicKeyJwk.x,
		y: publicKeyJwk.y,
	}
	const canonical = canonicalJson(normalized)
	const buffer = new TextEncoder().encode(canonical)
	const hash = await crypto.subtle.digest("SHA-256", buffer)
	return bufferToHex(hash)
}

export async function verifyKeyId(
	keyId: string,
	publicKeyJwk: JsonWebKey
): Promise<boolean> {
	const computed = await hashPublicKey(publicKeyJwk)
	return computed.toLowerCase() === keyId.toLowerCase()
}

function base64ToBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes.buffer
}

function bufferToHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer)
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
}

export function canonicalJson(obj: unknown): string {
	if (obj === null || typeof obj !== "object") {
		return JSON.stringify(obj)
	}
	if (Array.isArray(obj)) {
		return `[${obj.map(canonicalJson).join(",")}]`
	}
	const record = obj as Record<string, unknown>
	const sorted = Object.keys(record)
		.filter((k) => record[k] !== undefined)
		.sort()
	return `{${sorted.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`
}
