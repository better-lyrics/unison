import type { DiffRow } from "@/lib/revision-types"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { DiffView } from "./DiffView"

afterEach(cleanup)

const ROWS: DiffRow[] = [
  { kind: "gap", count: 2 },
  { kind: "same", lineNo: 3, startMs: 18600, text: "(stays, stays)" },
  {
    kind: "word",
    lineNo: 4,
    startMs: 21180,
    parts: [
      ["=", "I kept the "],
      ["-", "maps"],
      ["+", "map"],
      ["=", " you drew in pencil"],
    ],
  },
  { kind: "timing", lineNo: 5, startMs: 24620, deltaMs: -180, text: "Folded in the pocket of my days" },
  { kind: "del", lineNo: 6, startMs: 28200, text: "So run, run, the tide is turning" },
  { kind: "add", lineNo: 7, startMs: 30100, text: "(turning, turning)" },
  { kind: "add", lineNo: 1, startMs: null, text: "Traducción", head: { kind: "translation", lang: "es", line: 1 } },
]

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-row]")].map((r) => `${r.getAttribute("data-row")}|${r.textContent}`)

describe("DiffView unified", () => {
  it("shows every row with its line number, sign and timestamp", () => {
    const { container } = render(<DiffView rows={ROWS} mode="unified" />)
    expect(rows(container)).toEqual([
      "gap|2 unchanged lines",
      "same|3[00:18.60] (stays, stays)",
      "del|4-[00:21.18] I kept the maps you drew in pencil",
      "add|4+[00:21.18] I kept the map you drew in pencil",
      "timing|5~[00:24.62] Folded in the pocket of my days0.18 s earlier",
      "del|6-[00:28.20] So run, run, the tide is turning",
      "add|7+[00:30.10] (turning, turning)",
      "add|1+[translation es L1] Traducción",
    ])
  })

  it("marks the changed words inside a changed line", () => {
    const { container } = render(<DiffView rows={ROWS} mode="unified" />)
    expect([...container.querySelectorAll("[data-row='del'] mark")].map((m) => m.textContent)).toEqual(["maps"])
    expect([...container.querySelectorAll("[data-row='add'] mark")].map((m) => m.textContent)).toEqual(["map"])
  })
})

describe("DiffView split", () => {
  it("puts the old text on the left and the new text on the right", () => {
    const { container } = render(<DiffView rows={ROWS} mode="split" />)
    const [before, after] = [...container.querySelectorAll("[data-side]")] as HTMLElement[]
    expect(before.getAttribute("data-side")).toBe("before")
    expect(rows(before).map((r) => r.split("|")[0])).toEqual(["gap", "same", "del", "timing", "del"])
    expect(rows(after).map((r) => r.split("|")[0])).toEqual(["gap", "same", "add", "timing", "add", "add"])
    expect(before.textContent).toContain("[00:24.80]")
    expect(after.textContent).toContain("[00:24.62]")
  })
})

describe("DiffView edge cases", () => {
  it("says there are no line changes for an empty diff", () => {
    render(<DiffView rows={[]} mode="unified" />)
    expect(screen.getByText("No line changes.")).toBeTruthy()
  })

  it("uses the singular for one unchanged line and describes a later timing", () => {
    const { container } = render(
      <DiffView
        rows={[
          { kind: "gap", count: 1, section: "head" },
          { kind: "timing", lineNo: 2, startMs: 1000, deltaMs: 1500, text: "Late" },
        ]}
        mode="unified"
      />,
    )
    expect(rows(container)).toEqual(["gap|1 unchanged line", "timing|2~[00:01.00] Late1.50 s later"])
  })
})
