import { cleanup, render, screen } from "@testing-library/react"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it } from "vitest"
import { pageWidthClass, usePageWidth } from "./page-width"

function Probe() {
  return <span data-testid="width">{usePageWidth()}</span>
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Probe />,
        children: [
          { path: "songs", element: null },
          { path: "council", element: null, handle: { width: "wide" }, children: [{ path: "queue", element: null }] },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return screen.getByTestId("width").textContent
}

afterEach(cleanup)

describe("usePageWidth", () => {
  it("defaults to the standard width", () => {
    expect(renderAt("/songs")).toBe("default")
  })

  it("widens a route that asks for it, including its children", () => {
    expect(renderAt("/council")).toBe("wide")
    cleanup()
    expect(renderAt("/council/queue")).toBe("wide")
  })
})

describe("pageWidthClass", () => {
  it("keeps the standard container for default pages", () => {
    expect(pageWidthClass("default")).toBe("max-w-5xl px-6")
  })

  it("widens and adds side room for dashboards", () => {
    expect(pageWidthClass("wide")).toContain("max-w-[1760px]")
  })
})
