import type { SignedBody } from "./auth"

export const BL_EXTENSION_ID = "effdbpeggelllpfkjppbokhmmiinhlmg"

interface Port {
  onMessage: { addListener: (l: (msg: unknown) => void) => void }
  onDisconnect: { addListener: (l: () => void) => void }
  postMessage: (msg: unknown) => void
  disconnect: () => void
}

interface ChromeRuntime {
  connect: (id: string, info: { name: string }) => Port
  lastError?: { message: string }
}

function getRuntime(): ChromeRuntime | null {
  const c = (globalThis as { chrome?: { runtime?: Partial<ChromeRuntime> } }).chrome
  if (!c || !c.runtime || typeof c.runtime.connect !== "function") return null
  return c.runtime as ChromeRuntime
}

type AuthResponse = { ok: true; signedBody: SignedBody } | { ok: false; reason: string }

export function signInWithBetterLyrics(nonce: string): Promise<SignedBody> {
  return new Promise((resolve, reject) => {
    const runtime = getRuntime()
    if (!runtime) {
      reject(new Error("Better Lyrics extension not detected"))
      return
    }

    let port: Port
    try {
      port = runtime.connect(BL_EXTENSION_ID, { name: "bl-auth-site" })
    } catch {
      reject(new Error("Better Lyrics extension not installed or origin not allowed"))
      return
    }

    let settled = false

    port.onMessage.addListener((raw) => {
      if (settled) return
      settled = true
      const msg = raw as AuthResponse | null
      if (msg?.ok) {
        resolve(msg.signedBody)
      } else {
        reject(new Error(msg?.reason ?? "SIGN_FAILED"))
      }
      try {
        port.disconnect()
      } catch {}
    })

    port.onDisconnect.addListener(() => {
      if (settled) return
      settled = true
      reject(new Error(runtime.lastError?.message ?? "Port closed before response"))
    })

    port.postMessage({
      type: "bl-auth-request",
      nonce,
      origin: window.location.origin,
    })
  })
}

export function detectBetterLyrics(): "available" | "unavailable" {
  const runtime = getRuntime()
  if (!runtime) return "unavailable"
  try {
    const port = runtime.connect(BL_EXTENSION_ID, { name: "bl-probe" })
    port.disconnect()
    return "available"
  } catch {
    return "unavailable"
  }
}
