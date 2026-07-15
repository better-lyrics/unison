import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CodeBlock, type CodeTab, CodeTabs } from "./CodeBlock"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("CodeBlock", () => {
  it("renders the label and the code text", () => {
    render(<CodeBlock code={'curl "https://unison.boidu.dev/lyrics?v=abc"'} language="bash" label="cURL" />)
    expect(screen.getByText("cURL")).toBeTruthy()
    expect(document.body.textContent).toContain("https://unison.boidu.dev/lyrics?v=abc")
  })

  it("highlights the bash command word with a color", () => {
    render(<CodeBlock code={"# a note\ncurl https://x"} language="bash" label="cURL" />)
    const cmd = screen.getByText("curl")
    expect(cmd.tagName).toBe("SPAN")
    expect(cmd.getAttribute("style") ?? "").toMatch(/color/)
  })

  it("copies the code to the clipboard", () => {
    render(<CodeBlock code={"curl https://x"} language="bash" label="cURL" />)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    fireEvent.click(screen.getByRole("button", { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith("curl https://x")
  })
})

describe("CodeTabs", () => {
  const tabs: CodeTab[] = [
    { label: "cURL", language: "bash", code: 'curl "https://a"' },
    { label: "JavaScript", language: "javascript", code: 'const x = await fetch("https://a")' },
  ]

  it("shows the first tab by default and switches on click", () => {
    render(<CodeTabs tabs={tabs} />)
    expect(document.body.textContent).toContain("curl")
    expect(screen.getByRole("tab", { name: "cURL" }).getAttribute("aria-selected")).toBe("true")

    fireEvent.click(screen.getByRole("tab", { name: "JavaScript" }))

    expect(screen.getByRole("tab", { name: "JavaScript" }).getAttribute("aria-selected")).toBe("true")
    expect(document.body.textContent).toContain("fetch")
    expect(document.body.textContent).not.toContain("curl")
  })

  it("copies the active tab's code", () => {
    render(<CodeTabs tabs={tabs} />)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    fireEvent.click(screen.getByRole("button", { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith('curl "https://a"')
  })
})
