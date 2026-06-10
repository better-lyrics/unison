import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { type StoredSession, saveStoredSession } from "@/lib/auth"
import { NicknameEditor } from "./NicknameEditor"

const valid: StoredSession = {
  sessionToken: "tok",
  keyId: "k".repeat(64),
  displayName: "BrightVivaceRoll",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function meResponse(): Response {
  return jsonResponse({
    success: true,
    data: { keyId: valid.keyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
  })
}

interface FetchRoute {
  match: (url: string, init?: RequestInit) => boolean
  respond: () => Response | Promise<Response>
}

function fetchRouter(routes: FetchRoute[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const route = routes.find((r) => r.match(url, init))
    if (!route) throw new Error(`unrouted fetch: ${url}`)
    return route.respond()
  })
  return { fn, calls }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function mountEditor() {
  const result = render(
    <AuthProvider>
      <NicknameEditor />
    </AuthProvider>,
  )
  await flush()
  return result
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.unstubAllGlobals()
  saveStoredSession(valid)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("NicknameEditor", () => {
  it("prefills the input with the current session displayName", async () => {
    const router = fetchRouter([{ match: (u) => u === "/auth/me", respond: meResponse }])
    vi.stubGlobal("fetch", router.fn)
    await mountEditor()
    const input = screen.getByLabelText(/nickname/i) as HTMLInputElement
    expect(input.value).toBe(valid.displayName)
  })

  it("debounces the availability check by 350ms", async () => {
    const router = fetchRouter([
      { match: (u) => u === "/auth/me", respond: meResponse },
      {
        match: (u) => u.startsWith("/auth/nickname/availability"),
        respond: () => jsonResponse({ available: true }),
      },
    ])
    vi.stubGlobal("fetch", router.fn)
    await mountEditor()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "Alex" } })
    })
    expect(router.calls.some((c) => c.url.startsWith("/auth/nickname/availability"))).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(349)
    })
    expect(router.calls.some((c) => c.url.startsWith("/auth/nickname/availability"))).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await flush()
    expect(router.calls.some((c) => c.url === "/auth/nickname/availability?name=Alex")).toBe(true)
  })

  it("shows the checking status while the availability fetch is in flight", async () => {
    let resolveCheck: (res: Response) => void = () => undefined
    const checkPromise = new Promise<Response>((r) => {
      resolveCheck = r
    })
    const fn = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/auth/me") return meResponse()
      if (url.startsWith("/auth/nickname/availability")) return checkPromise
      throw new Error(`unrouted: ${url}`)
    })
    vi.stubGlobal("fetch", fn)
    await mountEditor()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "Alex" } })
      vi.advanceTimersByTime(350)
    })
    await flush()
    expect(screen.getByTestId("nickname-status").textContent ?? "").toMatch(/checking/i)
    await act(async () => {
      resolveCheck(jsonResponse({ available: true }))
    })
    await flush()
  })

  it("renders an inline hint and disables Save when the server reports INVALID_FORMAT", async () => {
    const router = fetchRouter([
      { match: (u) => u === "/auth/me", respond: meResponse },
      {
        match: (u) => u.startsWith("/auth/nickname/availability"),
        respond: () => jsonResponse({ available: false, reason: "INVALID_FORMAT" }),
      },
    ])
    vi.stubGlobal("fetch", router.fn)
    await mountEditor()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "ab" } })
      vi.advanceTimersByTime(350)
    })
    await flush()
    expect(screen.getByTestId("nickname-status").textContent ?? "").toMatch(/letters, numbers/i)
    const save = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it("renders Already taken and disables Save when the server reports TAKEN", async () => {
    const router = fetchRouter([
      { match: (u) => u === "/auth/me", respond: meResponse },
      {
        match: (u) => u.startsWith("/auth/nickname/availability"),
        respond: () => jsonResponse({ available: false, reason: "TAKEN" }),
      },
    ])
    vi.stubGlobal("fetch", router.fn)
    await mountEditor()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "taken" } })
      vi.advanceTimersByTime(350)
    })
    await flush()
    expect(screen.getByTestId("nickname-status").textContent ?? "").toMatch(/already taken/i)
    const save = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it("renders the SELF hint and disables Save when the server reports SELF", async () => {
    const router = fetchRouter([
      { match: (u) => u === "/auth/me", respond: meResponse },
      {
        match: (u) => u.startsWith("/auth/nickname/availability"),
        respond: () => jsonResponse({ available: true, reason: "SELF" }),
      },
    ])
    vi.stubGlobal("fetch", router.fn)
    await mountEditor()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "MyOwnName" } })
      vi.advanceTimersByTime(350)
    })
    await flush()
    expect(screen.getByTestId("nickname-status").textContent ?? "").toMatch(/current nickname/i)
    const save = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it("enables Save when the server reports available", async () => {
    const router = fetchRouter([
      { match: (u) => u === "/auth/me", respond: meResponse },
      {
        match: (u) => u.startsWith("/auth/nickname/availability"),
        respond: () => jsonResponse({ available: true }),
      },
    ])
    vi.stubGlobal("fetch", router.fn)
    await mountEditor()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "Alex" } })
      vi.advanceTimersByTime(350)
    })
    await flush()
    const save = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
  })

  it("PUTs /auth/nickname on Save and updates the session displayName", async () => {
    const router = fetchRouter([
      { match: (u) => u === "/auth/me", respond: meResponse },
      {
        match: (u) => u.startsWith("/auth/nickname/availability"),
        respond: () => jsonResponse({ available: true }),
      },
      {
        match: (u, init) => u === "/auth/nickname" && init?.method === "PUT",
        respond: () => jsonResponse({ success: true, data: { keyId: valid.keyId, displayName: "Alex" } }),
      },
    ])
    vi.stubGlobal("fetch", router.fn)
    await mountEditor()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "Alex" } })
      vi.advanceTimersByTime(350)
    })
    await flush()
    const save = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    await act(async () => {
      save.click()
    })
    await flush()
    const putCall = router.calls.find(
      (c) => c.url === "/auth/nickname" && (c.init?.method ?? "") === "PUT",
    )
    expect(putCall).toBeTruthy()
    expect(JSON.parse(putCall?.init?.body as string)).toEqual({ nickname: "Alex" })
    expect(screen.getByTestId("nickname-status").textContent ?? "").toMatch(/saved/i)
  })

  it("surfaces Already taken when PUT returns 409 NICKNAME_TAKEN", async () => {
    const router = fetchRouter([
      { match: (u) => u === "/auth/me", respond: meResponse },
      {
        match: (u) => u.startsWith("/auth/nickname/availability"),
        respond: () => jsonResponse({ available: true }),
      },
      {
        match: (u, init) => u === "/auth/nickname" && init?.method === "PUT",
        respond: () => jsonResponse({ success: false, error: "NICKNAME_TAKEN" }, 409),
      },
    ])
    vi.stubGlobal("fetch", router.fn)
    await mountEditor()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "Alex" } })
      vi.advanceTimersByTime(350)
    })
    await flush()
    await act(async () => {
      screen.getByRole("button", { name: /save/i }).click()
    })
    await flush()
    expect(screen.getByTestId("nickname-status").textContent ?? "").toMatch(/already taken/i)
    const save = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it("DELETEs /auth/nickname when Reset is clicked and updates the session displayName", async () => {
    const router = fetchRouter([
      { match: (u) => u === "/auth/me", respond: meResponse },
      {
        match: (u, init) => u === "/auth/nickname" && init?.method === "DELETE",
        respond: () => jsonResponse({ success: true, data: { keyId: valid.keyId, displayName: "GeneratedOne" } }),
      },
    ])
    vi.stubGlobal("fetch", router.fn)
    await mountEditor()
    await act(async () => {
      screen.getByRole("button", { name: /reset/i }).click()
    })
    await flush()
    const deleteCall = router.calls.find(
      (c) => c.url === "/auth/nickname" && (c.init?.method ?? "") === "DELETE",
    )
    expect(deleteCall).toBeTruthy()
    const input = screen.getByLabelText(/nickname/i) as HTMLInputElement
    expect(input.value).toBe("GeneratedOne")
  })

  it("surfaces Try again in a moment when the availability check returns 429", async () => {
    const router = fetchRouter([
      { match: (u) => u === "/auth/me", respond: meResponse },
      {
        match: (u) => u.startsWith("/auth/nickname/availability"),
        respond: () => jsonResponse({ success: false, error: "RATE_LIMITED" }, 429),
      },
    ])
    vi.stubGlobal("fetch", router.fn)
    await mountEditor()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/nickname/i), { target: { value: "Alex" } })
      vi.advanceTimersByTime(350)
    })
    await flush()
    expect(screen.getByTestId("nickname-status").textContent ?? "").toMatch(/try again in a moment/i)
  })
})
