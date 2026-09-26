import { hashPublicKey } from "../../../src/utils/crypto"

export interface IdentityExportFixture {
  version: 1
  keyId: string
  publicKey: JsonWebKey
  privateKey: JsonWebKey
  exportedAt: number
  certificate?: string
}

export async function makeIdentityExport(): Promise<IdentityExportFixture> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey)
  const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey)
  return { version: 1, keyId: await hashPublicKey(publicKey), publicKey, privateKey, exportedAt: Date.now() }
}

export function identityFile(contents: unknown, name = "better-lyrics-identity-BrightVivaceRoll.json"): File {
  const text = typeof contents === "string" ? contents : JSON.stringify(contents, null, 2)
  return new File([text], name, { type: "application/json" })
}
