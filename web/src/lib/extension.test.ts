import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BL_EXTENSION_ID, detectBetterLyrics, signInWithBetterLyrics } from "./extension"

type Listener<T> = (value: T) => void

interface PortHarness {
  port: {
    name: string
    onMessage: { addListener: (l: Listener<unknown>) => void }
    onDisconnect: { addListener: (l: Listener<void>) => void }
    postMessage: (m: unknown) => void
    disconnect: () => void
  }
  sentMessages: unknown[]
  fireMessage: (m: unknown) => void
  fireDisconnect: () => void
  listenerCounts: () => { onMessage: number; onDisconnect: number }
  isDisconnected: () => boolean
}

function makePort(name: string): PortHarness {
  const onMessageListeners: Listener<unknown>[] = []
  const onDisconnectListeners: Listener<void>[] = []
  const sentMessages: unknown[] = []
  let disconnected = false
  const harness: PortHarness = {
    port: {
      name,
      onMessage: {
        addListener: (l) => {
          onMessageListeners.push(l)
        },
      },
      onDisconnect: {
        addListener: (l) => {
          onDisconnectListeners.push(l)
        },
      },
      postMessage: (m) => {
        sentMessages.push(m)
      },
      disconnect: () => {
        disconnected = true
      },
    },
    sentMessages,
    fireMessage: (m) => {
      for (const l of onMessageListeners) l(m)
    },
    fireDisconnect: () => {
      for (const l of onDisconnectListeners) l()
    },
    listenerCounts: () => ({
      onMessage: onMessageListeners.length,
      onDisconnect: onDisconnectListeners.length,
    }),
    isDisconnected: () => disconnected,
  }
  return harness
}

interface ConnectCall {
  extensionId: string
  info: { name: string }
}

function installChrome(
  connect: (id: string, info: { name: string }) => PortHarness["port"],
  lastError?: { message: string },
): { connectCalls: ConnectCall[] } {
  const connectCalls: ConnectCall[] = []
  vi.stubGlobal("chrome", {
    runtime: {
      connect: (id: string, info: { name: string }) => {
        connectCalls.push({ extensionId: id, info })
        return connect(id, info)
      },
      lastError,
    },
  })
  return { connectCalls }
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

describe("signInWithBetterLyrics", () => {
  describe("happy paths", () => {
    it("resolves with the signedBody on an ok response", async () => {
      const signedBody = {
        payload: { origin: "x", timestamp: 1, nonce: "n", keyId: "kid" },
        signature: "sig",
        publicKey: { kty: "EC" },
      }
      let harness!: PortHarness
      installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const promise = signInWithBetterLyrics("n")
      harness.fireMessage({ ok: true, signedBody })
      await expect(promise).resolves.toEqual(signedBody)
    })

    it("sends the documented request message and uses the bl-auth-site port name", async () => {
      let harness!: PortHarness
      const { connectCalls } = installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const promise = signInWithBetterLyrics("nonce-xyz")
      expect(connectCalls[0].extensionId).toBe(BL_EXTENSION_ID)
      expect(connectCalls[0].info.name).toBe("bl-auth-site")
      expect(harness.sentMessages).toEqual([
        { type: "bl-auth-request", nonce: "nonce-xyz", origin: window.location.origin },
      ])
      harness.fireMessage({
        ok: true,
        signedBody: { payload: {}, signature: "", publicKey: {} },
      })
      await promise
    })
  })

  describe("error paths", () => {
    it("rejects with the raw reason on USER_CANCELLED", async () => {
      let harness!: PortHarness
      installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const promise = signInWithBetterLyrics("n")
      harness.fireMessage({ ok: false, reason: "USER_CANCELLED" })
      await expect(promise).rejects.toThrow("USER_CANCELLED")
    })

    it.each(["USER_DISMISSED", "SIGN_FAILED", "ORIGIN_MISMATCH", "INVALID_REQUEST"])(
      "rejects with the raw reason on %s",
      async (reason) => {
        let harness!: PortHarness
        installChrome((_id, info) => {
          harness = makePort(info.name)
          return harness.port
        })
        const promise = signInWithBetterLyrics("n")
        harness.fireMessage({ ok: false, reason })
        await expect(promise).rejects.toThrow(reason)
      },
    )

    it("rejects when chrome is undefined", async () => {
      await expect(signInWithBetterLyrics("n")).rejects.toThrow("Better Lyrics extension not detected")
    })

    it("rejects when chrome.runtime.connect is missing", async () => {
      vi.stubGlobal("chrome", { runtime: {} })
      await expect(signInWithBetterLyrics("n")).rejects.toThrow("Better Lyrics extension not detected")
    })

    it("rejects when chrome.runtime.connect throws synchronously", async () => {
      vi.stubGlobal("chrome", {
        runtime: {
          connect: () => {
            throw new Error("no extension")
          },
        },
      })
      await expect(signInWithBetterLyrics("n")).rejects.toThrow(
        "Better Lyrics extension not installed or origin not allowed",
      )
    })

    it("rejects with lastError.message when the port disconnects before a response", async () => {
      let harness!: PortHarness
      installChrome(
        (_id, info) => {
          harness = makePort(info.name)
          return harness.port
        },
        { message: "Could not establish connection. Receiving end does not exist." },
      )
      const promise = signInWithBetterLyrics("n")
      harness.fireDisconnect()
      await expect(promise).rejects.toThrow("Could not establish connection. Receiving end does not exist.")
    })

    it("rejects with a generic message when the port disconnects with no lastError", async () => {
      let harness!: PortHarness
      installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const promise = signInWithBetterLyrics("n")
      harness.fireDisconnect()
      await expect(promise).rejects.toThrow("Port closed before response")
    })
  })

  describe("invariants", () => {
    it("registers onMessage and onDisconnect listeners before postMessage runs", async () => {
      let countsAtPost: { onMessage: number; onDisconnect: number } | null = null
      let harness!: PortHarness
      installChrome((_id, info) => {
        harness = makePort(info.name)
        const original = harness.port.postMessage
        harness.port.postMessage = (m) => {
          countsAtPost = harness.listenerCounts()
          original(m)
        }
        return harness.port
      })
      const promise = signInWithBetterLyrics("n")
      expect(countsAtPost).not.toBeNull()
      expect((countsAtPost as unknown as { onMessage: number }).onMessage).toBeGreaterThanOrEqual(1)
      expect((countsAtPost as unknown as { onDisconnect: number }).onDisconnect).toBeGreaterThanOrEqual(1)
      harness.fireMessage({ ok: true, signedBody: { payload: {}, signature: "", publicKey: {} } })
      await promise
    })

    it("disconnects the port after a successful response", async () => {
      let harness!: PortHarness
      installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const promise = signInWithBetterLyrics("n")
      harness.fireMessage({
        ok: true,
        signedBody: { payload: {}, signature: "", publicKey: {} },
      })
      await promise
      expect(harness.isDisconnected()).toBe(true)
    })

    it("disconnects the port after an error response", async () => {
      let harness!: PortHarness
      installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const promise = signInWithBetterLyrics("n")
      harness.fireMessage({ ok: false, reason: "USER_CANCELLED" })
      await expect(promise).rejects.toThrow("USER_CANCELLED")
      expect(harness.isDisconnected()).toBe(true)
    })

    it("a late onDisconnect after a settled onMessage does not produce an unhandled rejection", async () => {
      let harness!: PortHarness
      installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const unhandled: unknown[] = []
      const onUnhandled = (e: PromiseRejectionEvent) => {
        unhandled.push(e.reason)
      }
      window.addEventListener("unhandledrejection", onUnhandled)
      try {
        const promise = signInWithBetterLyrics("n")
        harness.fireMessage({
          ok: true,
          signedBody: { payload: {}, signature: "", publicKey: {} },
        })
        await promise
        harness.fireDisconnect()
        await new Promise((r) => setTimeout(r, 0))
        expect(unhandled).toEqual([])
      } finally {
        window.removeEventListener("unhandledrejection", onUnhandled)
      }
    })

    it("a late onMessage after onDisconnect rejected does not flip the result", async () => {
      let harness!: PortHarness
      installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const promise = signInWithBetterLyrics("n")
      const rejected = promise.catch((e) => e)
      harness.fireDisconnect()
      const first = await rejected
      expect(first).toBeInstanceOf(Error)
      harness.fireMessage({
        ok: true,
        signedBody: { payload: {}, signature: "", publicKey: {} },
      })
      const second = await promise.then(
        () => "resolved",
        (e) => e,
      )
      expect(second).toBe(first)
    })
  })
})

describe("detectBetterLyrics", () => {
  describe("unavailable paths", () => {
    it("resolves to 'unavailable' when chrome is undefined", async () => {
      await expect(detectBetterLyrics()).resolves.toBe("unavailable")
    })

    it("resolves to 'unavailable' when chrome.runtime.connect is missing", async () => {
      vi.stubGlobal("chrome", { runtime: {} })
      await expect(detectBetterLyrics()).resolves.toBe("unavailable")
    })

    it("resolves to 'unavailable' when chrome.runtime.connect throws synchronously", async () => {
      vi.stubGlobal("chrome", {
        runtime: {
          connect: () => {
            throw new Error("no extension")
          },
        },
      })
      await expect(detectBetterLyrics()).resolves.toBe("unavailable")
    })

    it("resolves to 'unavailable' when the port disconnects with lastError set", async () => {
      let harness!: PortHarness
      installChrome(
        (_id, info) => {
          harness = makePort(info.name)
          return harness.port
        },
        { message: "Could not establish connection. Receiving end does not exist." },
      )
      const promise = detectBetterLyrics()
      harness.fireDisconnect()
      await expect(promise).resolves.toBe("unavailable")
    })
  })

  describe("available paths", () => {
    it("resolves to 'available' when the port disconnects with no lastError", async () => {
      let harness!: PortHarness
      installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const promise = detectBetterLyrics()
      harness.fireDisconnect()
      await expect(promise).resolves.toBe("available")
    })

    it("resolves to 'available' when no events fire before the timeout", async () => {
      const harness = makePort("bl-probe")
      installChrome(() => harness.port)
      await expect(detectBetterLyrics(5)).resolves.toBe("available")
    })
  })

  describe("invariants", () => {
    it("uses the bl-probe port name (not bl-auth-site)", async () => {
      let harness!: PortHarness
      const { connectCalls } = installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const promise = detectBetterLyrics()
      harness.fireDisconnect()
      await promise
      expect(connectCalls[0].info.name).toBe("bl-probe")
    })

    it("disconnects the probe port after settling", async () => {
      let harness!: PortHarness
      installChrome((_id, info) => {
        harness = makePort(info.name)
        return harness.port
      })
      const promise = detectBetterLyrics()
      harness.fireDisconnect()
      await promise
      expect(harness.isDisconnected()).toBe(true)
    })

    it("disconnects the probe port after the timeout fallback fires", async () => {
      const harness = makePort("bl-probe")
      installChrome(() => harness.port)
      await detectBetterLyrics(5)
      expect(harness.isDisconnected()).toBe(true)
    })
  })
})
