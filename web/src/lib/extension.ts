import type { SignedBody } from "./auth"

export const BL_EXTENSION_ID = "effdbpeggelllpfkjppbokhmmiinhlmg"
export const BL_EDGE_EXTENSION_ID = "mjfeaklppoegooljmjicjdbiccgjdlhd"
export const BL_EXTENSION_IDS = [BL_EXTENSION_ID, BL_EDGE_EXTENSION_ID] as const

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

export function signInWithBetterLyrics(nonce: string, extensionId: string): Promise<SignedBody> {
  return new Promise((resolve, reject) => {
    const runtime = getRuntime()
    if (!runtime) {
      reject(new Error("Better Lyrics extension not detected"))
      return
    }

    let port: Port
    try {
      port = runtime.connect(extensionId, { name: "bl-auth-site" })
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

function probe(runtime: ChromeRuntime, extensionId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let port: Port
    try {
      port = runtime.connect(extensionId, { name: "bl-probe" })
    } catch {
      resolve(false)
      return
    }

    let settled = false
    const settle = (found: boolean) => {
      if (settled) return
      settled = true
      try {
        port.disconnect()
      } catch {}
      resolve(found)
    }

    const timer = setTimeout(() => settle(true), timeoutMs)

    port.onDisconnect.addListener(() => {
      clearTimeout(timer)
      settle(!runtime.lastError)
    })
  })
}

export async function findBetterLyrics(timeoutMs = 200): Promise<string | null> {
  const runtime = getRuntime()
  if (!runtime) return null
  const found = await Promise.all(BL_EXTENSION_IDS.map((id) => probe(runtime, id, timeoutMs)))
  return BL_EXTENSION_IDS.find((_, i) => found[i]) ?? null
}
