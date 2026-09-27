import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UserSubmission } from "@/lib/types"
import { SubmissionsList } from "./SubmissionsList"

const keyId = "u".repeat(64)
const base = `/users/${keyId}/submissions`

function submission(id: number, song: string, over: Partial<UserSubmission> = {}): UserSubmission {
  return {
    id,
    videoId: `vid${id}`,
    song,
    artist: "Artist",
    duration: 180,
    format: "lrc",
    syncType: "linesync",
    effectiveScore: 1,
    voteCount: 1,
    confidence: "low",
    createdAt: 1_700_000_000 - id,
    hidden: false,
    ...over,
  }
}

function ok(data: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }))
}

type Route = Record<string, { submissions: UserSubmission[]; nextCursor?: string }>

function stubRoutes(routes: Route) {
  const requested: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/submissions")) requested.push(url)
      const body = routes[url]
      if (!body) return Promise.resolve(new Response("not found", { status: 404 }))
      return ok(body)
    }),
  )
  return requested
}

function tree(qc: QueryClient, forKey: string) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SubmissionsList keyId={forKey} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(tree(qc, keyId))
  return { ...view, switchTo: (next: string) => view.rerender(tree(qc, next)) }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SubmissionsList", () => {
  it("requests the unfiltered first page without query params", async () => {
    const requested = stubRoutes({ [base]: { submissions: [submission(1, "First Song")] } })
    renderList()
    await waitFor(() => expect(screen.getByText("First Song")).toBeTruthy())
    expect(requested).toEqual([base])
  })

  it("regression: search finds submissions beyond the loaded page", async () => {
    stubRoutes({
      [base]: { submissions: [submission(1, "Loaded Song")], nextCursor: "1:1" },
      [`${base}?q=deep`]: { submissions: [submission(99, "Deep Cut")] },
    })
    renderList()
    await waitFor(() => expect(screen.getByText("Loaded Song")).toBeTruthy())
    fireEvent.change(screen.getByLabelText("Search submissions"), { target: { value: "  deep " } })
    await waitFor(() => expect(screen.getByText("Deep Cut")).toBeTruthy())
    expect(screen.queryByText("Loaded Song")).toBeNull()
  })

  it("sends the sync type filter and sort to the server", async () => {
    stubRoutes({
      [base]: { submissions: [submission(1, "Line Song")] },
      [`${base}?syncType=richsync`]: { submissions: [submission(2, "Rich Song")] },
      [`${base}?syncType=richsync&sort=most_votes`]: {
        submissions: [submission(3, "Top Rich Song")],
      },
    })
    renderList()
    await waitFor(() => expect(screen.getByText("Line Song")).toBeTruthy())
    fireEvent.change(screen.getByLabelText("Filter by sync type"), {
      target: { value: "richsync" },
    })
    await waitFor(() => expect(screen.getByText("Rich Song")).toBeTruthy())
    fireEvent.change(screen.getByLabelText("Sort submissions"), { target: { value: "most_votes" } })
    await waitFor(() => expect(screen.getByText("Top Rich Song")).toBeTruthy())
  })

  it("keeps the active filters when loading more", async () => {
    stubRoutes({
      [base]: { submissions: [submission(1, "Line Song")] },
      [`${base}?syncType=plain`]: { submissions: [submission(2, "Plain One")], nextCursor: "5:2" },
      [`${base}?syncType=plain&cursor=5%3A2`]: { submissions: [submission(3, "Plain Two")] },
    })
    renderList()
    await waitFor(() => expect(screen.getByText("Line Song")).toBeTruthy())
    fireEvent.change(screen.getByLabelText("Filter by sync type"), { target: { value: "plain" } })
    await waitFor(() => expect(screen.getByText("Plain One")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    await waitFor(() => expect(screen.getByText("Plain Two")).toBeTruthy())
    expect(screen.getByText("Plain One")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
  })

  describe("edge cases", () => {
    it("shows the empty profile state only when no filter is active", async () => {
      stubRoutes({ [base]: { submissions: [] } })
      renderList()
      await waitFor(() => expect(screen.getByText(/no submissions yet/i)).toBeTruthy())
    })

    it("keeps the toolbar and says no match when a filter matches nothing", async () => {
      stubRoutes({
        [base]: { submissions: [submission(1, "Line Song")] },
        [`${base}?syncType=plain`]: { submissions: [] },
      })
      renderList()
      await waitFor(() => expect(screen.getByText("Line Song")).toBeTruthy())
      fireEvent.change(screen.getByLabelText("Filter by sync type"), { target: { value: "plain" } })
      await waitFor(() => expect(screen.getByText(/no submissions match/i)).toBeTruthy())
      expect(screen.getByLabelText("Filter by sync type")).toBeTruthy()
      expect(screen.queryByText(/no submissions yet/i)).toBeNull()
    })

    it("does not send a whitespace-only search", async () => {
      const requested = stubRoutes({ [base]: { submissions: [submission(1, "Line Song")] } })
      renderList()
      await waitFor(() => expect(screen.getByText("Line Song")).toBeTruthy())
      fireEvent.change(screen.getByLabelText("Search submissions"), { target: { value: "   " } })
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(requested).toEqual([base])
    })
  })

  describe("invariants", () => {
    it("debounces typing into a single request for the final search", async () => {
      const requested = stubRoutes({
        [base]: { submissions: [submission(1, "Line Song")] },
        [`${base}?q=abc`]: { submissions: [submission(2, "Abc Song")] },
      })
      renderList()
      await waitFor(() => expect(screen.getByText("Line Song")).toBeTruthy())
      const input = screen.getByLabelText("Search submissions")
      fireEvent.change(input, { target: { value: "a" } })
      fireEvent.change(input, { target: { value: "ab" } })
      fireEvent.change(input, { target: { value: "abc" } })
      await waitFor(() => expect(screen.getByText("Abc Song")).toBeTruthy())
      expect(requested).toEqual([base, `${base}?q=abc`])
    })
  })

  describe("cross-field interactions", () => {
    it("resets filters and never shows the previous curator's rows when the profile changes", async () => {
      const otherKey = "v".repeat(64)
      let releaseOther: () => void = () => {}
      const otherGate = new Promise<void>((resolve) => {
        releaseOther = resolve
      })
      const requested: string[] = []
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString()
          if (url.includes("/submissions")) requested.push(url)
          if (url === base) return ok({ submissions: [submission(1, "First Curator Song")] })
          if (url === `${base}?syncType=plain`) {
            return ok({ submissions: [submission(2, "First Curator Plain")] })
          }
          if (url === `/users/${otherKey}/submissions`) {
            await otherGate
            return ok({ submissions: [submission(3, "Second Curator Song")] })
          }
          return new Response("not found", { status: 404 })
        }),
      )
      const { switchTo } = renderList()
      await waitFor(() => expect(screen.getByText("First Curator Song")).toBeTruthy())
      fireEvent.change(screen.getByLabelText("Filter by sync type"), { target: { value: "plain" } })
      await waitFor(() => expect(screen.getByText("First Curator Plain")).toBeTruthy())

      switchTo(otherKey)
      await waitFor(() => expect(screen.queryByText("First Curator Plain")).toBeNull())
      releaseOther()
      await waitFor(() => expect(screen.getByText("Second Curator Song")).toBeTruthy())
      expect((screen.getByLabelText("Filter by sync type") as HTMLSelectElement).value).toBe("all")
      expect(requested).toEqual([base, `${base}?syncType=plain`, `/users/${otherKey}/submissions`])
    })

    it("does not carry a debounced search over to the next profile", async () => {
      const otherKey = "w".repeat(64)
      const requested = stubRoutes({
        [base]: { submissions: [submission(1, "Line Song")] },
        [`${base}?q=deep`]: { submissions: [submission(2, "Deep Cut")] },
        [`/users/${otherKey}/submissions`]: { submissions: [submission(3, "Other Song")] },
      })
      const { switchTo } = renderList()
      await waitFor(() => expect(screen.getByText("Line Song")).toBeTruthy())
      fireEvent.change(screen.getByLabelText("Search submissions"), { target: { value: "deep" } })
      await waitFor(() => expect(screen.getByText("Deep Cut")).toBeTruthy())
      switchTo(otherKey)
      await waitFor(() => expect(screen.getByText("Other Song")).toBeTruthy())
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(requested).toEqual([base, `${base}?q=deep`, `/users/${otherKey}/submissions`])
    })
  })

  describe("error paths", () => {
    it("shows an error when the first page fails", async () => {
      stubRoutes({})
      renderList()
      await waitFor(() => expect(screen.getByText(/could not load submissions/i)).toBeTruthy())
    })
  })
})
