import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  canonicalJson as serverCanonicalJson,
  isTimestampFresh,
  verifyKeyId,
  verifySignature,
} from "../../../src/utils/crypto"
import { identityFile, makeIdentityExport } from "@/test/identity-fixture"
import { canonicalJson } from "./canonical-json"
import { IDENTITY_FILE_ERRORS, signInWithIdentityFile } from "./identity-file"

interface SignedPayload {
  origin: string
  timestamp: number
  nonce: string
  keyId: string
}

const NONCE = "challenge-nonce-0123456789abcdef"

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe("signInWithIdentityFile", () => {
  describe("happy paths", () => {
    it("produces a body the server verifier accepts", async () => {
      const exported = await makeIdentityExport()
      const body = await signInWithIdentityFile(identityFile(exported), NONCE)
      const payload = body.payload as SignedPayload
      expect(await verifySignature(payload, body.signature, body.publicKey as JsonWebKey)).toBe(true)
      expect(await verifyKeyId(payload.keyId, body.publicKey as JsonWebKey)).toBe(true)
    })

    it("signs the page origin, the challenge nonce, a fresh timestamp and the file keyId", async () => {
      const exported = await makeIdentityExport()
      const body = await signInWithIdentityFile(identityFile(exported), NONCE)
      const payload = body.payload as SignedPayload
      expect(payload.origin).toBe(window.location.origin)
      expect(payload.nonce).toBe(NONCE)
      expect(payload.keyId).toBe(exported.keyId)
      expect(isTimestampFresh(payload.timestamp)).toBe(true)
      expect(body.publicKey).toEqual(exported.publicKey)
    })

    it("accepts an export that carries a certificate", async () => {
      const exported = { ...(await makeIdentityExport()), certificate: "cert-blob" }
      const body = await signInWithIdentityFile(identityFile(exported), NONCE)
      expect(await verifySignature(body.payload as object, body.signature, body.publicKey as JsonWebKey)).toBe(true)
    })
  })

  describe("edge cases", () => {
    it("regression: rejects an uppercase keyId, which the server would register as a second account", async () => {
      const exported = await makeIdentityExport()
      await expect(
        signInWithIdentityFile(identityFile({ ...exported, keyId: exported.keyId.toUpperCase() }), NONCE),
      ).rejects.toThrow(IDENTITY_FILE_ERRORS.damaged)
    })

    it("tolerates extra JWK fields such as key_ops and ext", async () => {
      const exported = await makeIdentityExport()
      expect(exported.privateKey.key_ops).toBeDefined()
      await expect(signInWithIdentityFile(identityFile(exported), NONCE)).resolves.toBeTruthy()
    })
  })

  describe("error paths", () => {
    it.each([
      ["an empty file", ""],
      ["plain text", "hello"],
      ["a JSON array", "[]"],
      ["JSON null", "null"],
    ])("rejects %s as not an identity export", async (_label, contents) => {
      await expect(signInWithIdentityFile(identityFile(contents), NONCE)).rejects.toThrow(
        IDENTITY_FILE_ERRORS.notIdentity,
      )
    })

    it("rejects an unknown version", async () => {
      const exported = await makeIdentityExport()
      await expect(signInWithIdentityFile(identityFile({ ...exported, version: 2 }), NONCE)).rejects.toThrow(
        IDENTITY_FILE_ERRORS.notIdentity,
      )
    })

    it("rejects a key on another curve", async () => {
      const exported = await makeIdentityExport()
      const publicKey = { ...exported.publicKey, crv: "P-384" }
      await expect(signInWithIdentityFile(identityFile({ ...exported, publicKey }), NONCE)).rejects.toThrow(
        IDENTITY_FILE_ERRORS.notIdentity,
      )
    })

    it("rejects an export without the private scalar", async () => {
      const exported = await makeIdentityExport()
      const { d: _d, ...privateKey } = exported.privateKey
      await expect(signInWithIdentityFile(identityFile({ ...exported, privateKey }), NONCE)).rejects.toThrow(
        IDENTITY_FILE_ERRORS.notIdentity,
      )
    })

    it("rejects a keyId that does not match the public key", async () => {
      const exported = await makeIdentityExport()
      await expect(
        signInWithIdentityFile(identityFile({ ...exported, keyId: "0".repeat(64) }), NONCE),
      ).rejects.toThrow(IDENTITY_FILE_ERRORS.damaged)
    })

    it("rejects a private key that belongs to another public key", async () => {
      const exported = await makeIdentityExport()
      const other = await makeIdentityExport()
      await expect(
        signInWithIdentityFile(identityFile({ ...exported, privateKey: other.privateKey }), NONCE),
      ).rejects.toThrow(IDENTITY_FILE_ERRORS.damaged)
    })

    it("rejects a corrupted private scalar", async () => {
      const exported = await makeIdentityExport()
      const privateKey = { ...exported.privateKey, d: "not-a-scalar" }
      await expect(signInWithIdentityFile(identityFile({ ...exported, privateKey }), NONCE)).rejects.toThrow(
        IDENTITY_FILE_ERRORS.damaged,
      )
    })
  })

  describe("invariants", () => {
    it("never writes the key to storage", async () => {
      const exported = await makeIdentityExport()
      await signInWithIdentityFile(identityFile(exported), NONCE)
      expect(localStorage.length).toBe(0)
    })

    it("does not put the private scalar in the signed body", async () => {
      const exported = await makeIdentityExport()
      const body = await signInWithIdentityFile(identityFile(exported), NONCE)
      expect(JSON.stringify(body)).not.toContain(exported.privateKey.d as string)
    })
  })
})

describe("canonicalJson", () => {
  it.each([
    { b: 1, a: 2 },
    { nested: { z: [3, { y: 1, x: 2 }], a: null }, s: 'é ✓ "q"' },
    { dropped: undefined, kept: 0 },
    [1, "two", { b: true, a: false }],
    "plain",
    42,
    null,
  ])("matches the server serializer for %j", (value) => {
    expect(canonicalJson(value)).toBe(serverCanonicalJson(value))
  })
})
