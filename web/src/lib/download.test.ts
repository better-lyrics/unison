import { afterEach, describe, expect, it, vi } from "vitest"
import { downloadTextFile } from "./download"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("downloadTextFile", () => {
  it("clicks a transient anchor carrying the filename and body, then revokes the url", async () => {
    const createObjectURL = vi.fn(() => "blob:mock-url")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL } as unknown as typeof URL)
    let anchor: HTMLAnchorElement | undefined
    const create = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = create(tag)
      if (tag === "a") anchor = el as HTMLAnchorElement
      return el
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    downloadTextFile("Song - Artist.lrc", "[00:01.00]hi", "text/plain;charset=utf-8")

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(anchor?.download).toBe("Song - Artist.lrc")
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as unknown as Blob
    expect(blob.type).toBe("text/plain;charset=utf-8")
    expect(await blob.text()).toBe("[00:01.00]hi")
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url")
  })

  it("leaves no anchor attached to the document afterward", () => {
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} } as unknown as typeof URL)
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const before = document.querySelectorAll("a").length
    downloadTextFile("f.txt", "x", "text/plain;charset=utf-8")
    expect(document.querySelectorAll("a").length).toBe(before)
  })
})
