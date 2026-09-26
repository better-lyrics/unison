import type { SignedBody } from "./auth"
import { canonicalJson } from "./canonical-json"

export const IDENTITY_FILE_ERRORS = {
  notIdentity: "This file is not a Better Lyrics identity export.",
  damaged: "This identity file is damaged. Export it again from Better Lyrics.",
} as const

const ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const
const ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const

interface IdentityExport {
  keyId: string
  publicKey: JsonWebKey
  privateKey: JsonWebKey
}

function isP256Jwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== "object") return false
  const jwk = value as Record<string, unknown>
  return jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.x === "string" && typeof jwk.y === "string"
}

function parseIdentityExport(text: string): IdentityExport {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(IDENTITY_FILE_ERRORS.notIdentity)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(IDENTITY_FILE_ERRORS.notIdentity)
  const file = parsed as Record<string, unknown>
  const { publicKey, privateKey, keyId } = file
  if (
    file.version !== 1 ||
    typeof keyId !== "string" ||
    keyId.length !== 64 ||
    !isP256Jwk(publicKey) ||
    !isP256Jwk(privateKey) ||
    typeof privateKey.d !== "string"
  ) {
    throw new Error(IDENTITY_FILE_ERRORS.notIdentity)
  }
  return { keyId, publicKey, privateKey }
}

async function hashPublicKey(jwk: JsonWebKey): Promise<string> {
  const canonical = canonicalJson({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

function toBase64(buffer: ArrayBuffer): string {
  let binary = ""
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function importSigningKey(identity: IdentityExport): Promise<CryptoKey> {
  const sameKey = identity.privateKey.x === identity.publicKey.x && identity.privateKey.y === identity.publicKey.y
  if (!sameKey || (await hashPublicKey(identity.publicKey)) !== identity.keyId.toLowerCase()) {
    throw new Error(IDENTITY_FILE_ERRORS.damaged)
  }
  try {
    return await crypto.subtle.importKey("jwk", identity.privateKey, ECDSA_P256, false, ["sign"])
  } catch {
    throw new Error(IDENTITY_FILE_ERRORS.damaged)
  }
}

export async function signInWithIdentityFile(file: File, nonce: string): Promise<SignedBody> {
  const identity = parseIdentityExport(await file.text())
  const key = await importSigningKey(identity)
  const payload = { origin: window.location.origin, timestamp: Date.now(), nonce, keyId: identity.keyId }
  const signature = await crypto.subtle.sign(ECDSA_SHA256, key, new TextEncoder().encode(canonicalJson(payload)))
  return { payload, signature: toBase64(signature), publicKey: identity.publicKey }
}
