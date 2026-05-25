import type { SignedBody } from "./auth"

export const BL_EXTENSION_ID = "effdbpeggelllpfkjppbokhmmiinhlmg"

type ChromeSendMessage = (id: string, msg: unknown) => Promise<unknown>

interface ChromeRuntime {
  sendMessage: ChromeSendMessage
}

function getRuntime(): ChromeRuntime | null {
  const c = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome
  if (!c || !c.runtime || typeof c.runtime.sendMessage !== "function") return null
  return c.runtime
}

export async function isExtensionAvailable(): Promise<boolean> {
  const runtime = getRuntime()
  if (!runtime) return false
  try {
    const reply = await runtime.sendMessage(BL_EXTENSION_ID, { type: "bl-ping" })
    return reply !== undefined && reply !== null
  } catch {
    return false
  }
}

type AuthResponse = { ok: true; signedBody: SignedBody } | { ok: false; reason: string }

export async function requestSignedAssertion(nonce: string, origin: string): Promise<SignedBody> {
  const runtime = getRuntime()
  if (!runtime) throw new Error("EXTENSION_UNAVAILABLE")
  let reply: AuthResponse
  try {
    reply = (await runtime.sendMessage(BL_EXTENSION_ID, {
      type: "bl-auth-request",
      nonce,
      origin,
    })) as AuthResponse
  } catch {
    throw new Error("EXTENSION_UNAVAILABLE")
  }
  if (!reply || typeof reply !== "object") throw new Error("EXTENSION_UNAVAILABLE")
  if (!reply.ok) throw new Error(reply.reason || "SIGN_FAILED")
  return reply.signedBody
}
