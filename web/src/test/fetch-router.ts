import { vi } from "vitest"

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

export interface FetchRoute {
  match: (url: string, init?: RequestInit) => boolean
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>
}

export function fetchRouter(routes: FetchRoute[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const route = routes.find((r) => r.match(url, init))
    if (!route) throw new Error(`unrouted fetch: ${url}`)
    return route.respond(url, init)
  })
  return { fn, calls }
}
