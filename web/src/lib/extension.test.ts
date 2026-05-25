import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BL_EXTENSION_ID, isExtensionAvailable, requestSignedAssertion } from "./extension"

type SendMessageFn = (id: string, msg: unknown) => Promise<unknown>

function installChromeMock(sendMessage: SendMessageFn) {
  vi.stubGlobal("chrome", {
    runtime: { sendMessage },
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("BL_EXTENSION_ID", () => {
  it("is the chrome web store id", () => {
    expect(BL_EXTENSION_ID).toBe("effdbpeggelllpfkjppbokhmmiinhlmg")
  })
})

describe("isExtensionAvailable", () => {
  it("returns false when chrome.runtime is not present", async () => {
    expect(await isExtensionAvailable()).toBe(false)
  })

  it("returns true when ping succeeds", async () => {
    installChromeMock(async () => ({ ok: true }))
    expect(await isExtensionAvailable()).toBe(true)
  })

  it("returns false when sendMessage rejects", async () => {
    installChromeMock(async () => {
      throw new Error("no extension")
    })
    expect(await isExtensionAvailable()).toBe(false)
  })

  it("returns false when sendMessage resolves to undefined (extension absent)", async () => {
    installChromeMock(async () => undefined)
    expect(await isExtensionAvailable()).toBe(false)
  })
})

describe("requestSignedAssertion", () => {
  it("returns the signedBody on ok response", async () => {
    const signedBody = { payload: { nonce: "n" }, signature: "s", publicKey: {} }
    installChromeMock(async (id, msg) => {
      expect(id).toBe(BL_EXTENSION_ID)
      expect(msg).toEqual({ type: "bl-auth-request", nonce: "n", origin: "https://x.test" })
      return { ok: true, signedBody }
    })
    await expect(requestSignedAssertion("n", "https://x.test")).resolves.toEqual(signedBody)
  })

  it("throws with the documented reason on ok:false", async () => {
    installChromeMock(async () => ({ ok: false, reason: "USER_CANCELLED" }))
    await expect(requestSignedAssertion("n", "https://x.test")).rejects.toThrow("USER_CANCELLED")
  })

  it("throws EXTENSION_UNAVAILABLE when chrome.runtime is missing", async () => {
    await expect(requestSignedAssertion("n", "https://x.test")).rejects.toThrow("EXTENSION_UNAVAILABLE")
  })

  it("throws EXTENSION_UNAVAILABLE when sendMessage rejects", async () => {
    installChromeMock(async () => {
      throw new Error("disconnected")
    })
    await expect(requestSignedAssertion("n", "https://x.test")).rejects.toThrow("EXTENSION_UNAVAILABLE")
  })

  it("throws SIGN_FAILED when reply is an object missing ok and reason", async () => {
    installChromeMock(async () => ({}))
    await expect(requestSignedAssertion("n", "https://x.test")).rejects.toThrow("SIGN_FAILED")
  })
})
