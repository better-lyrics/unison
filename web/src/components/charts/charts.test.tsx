import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Histogram } from "./Histogram"
import { Sparkline } from "./Sparkline"
import { StackedBars } from "./StackedBars"

afterEach(cleanup)

const series = [
  { key: "sealed", label: "Sealed", color: "var(--color-council-seal)", values: [1, 0, 2] },
  { key: "rejected", label: "Rejected", color: "var(--color-council-reject)", values: [0, 3, 1] },
]

describe("StackedBars", () => {
  it("labels the chart, shows series totals and draws one mark per non-zero value", () => {
    const { container } = render(
      <StackedBars
        series={series}
        labels={["1 Sept", "2 Sept", "3 Sept"]}
        axisLabelAt={[0, 2]}
        ariaLabel="Decisions"
      />,
    )
    expect(screen.getByRole("img", { name: "Decisions" })).toBeTruthy()
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Sealed3", "Rejected4"])
    const marks = container.querySelectorAll("[data-column] path, [data-column] rect[fill^='var']")
    expect(marks).toHaveLength(4)
  })

  it("shows every value of a day on hover and dims the other days", () => {
    const { container } = render(
      <StackedBars series={series} labels={["1 Sept", "2 Sept", "3 Sept"]} axisLabelAt={[]} ariaLabel="Decisions" />,
    )
    const column = container.querySelector("[data-column='1']") as Element
    fireEvent.pointerEnter(column)
    const tip = container.querySelector("[role='presentation']")
    expect(tip?.textContent).toContain("2 Sept")
    expect(tip?.textContent).toContain("Rejected3")
    expect(container.querySelector("[data-column='0']")?.getAttribute("class")).toContain("opacity-35")
  })

  it("offers the same data as a table", () => {
    render(<StackedBars series={series} labels={["1 Sept", "2 Sept", "3 Sept"]} axisLabelAt={[]} ariaLabel="x" />)
    expect(screen.getAllByRole("row")).toHaveLength(4)
  })

  describe("edge cases", () => {
    it("renders an empty month without marks", () => {
      const { container } = render(
        <StackedBars
          series={series.map((s) => ({ ...s, values: [0, 0, 0] }))}
          labels={["a", "b", "c"]}
          axisLabelAt={[]}
          ariaLabel="x"
        />,
      )
      expect(container.querySelectorAll("[data-column] path")).toHaveLength(0)
    })
  })
})

describe("Histogram", () => {
  it("labels each bucket with its value and skips empty bars", () => {
    const { container } = render(
      <Histogram
        buckets={[
          { label: "Under 1d", value: 4 },
          { label: "Over 2w", value: 0 },
        ]}
        color="var(--color-council-edit)"
        ariaLabel="Waiting"
      />,
    )
    expect(screen.getByRole("img", { name: "Waiting" })).toBeTruthy()
    expect(container.querySelectorAll("path")).toHaveLength(1)
    expect(container.querySelector("[data-bucket='Over 2w'] title")?.textContent).toBe("Over 2w: 0 waiting")
  })
})

describe("Sparkline", () => {
  it("draws a line through every value and marks the latest", () => {
    const { container } = render(<Sparkline values={[1, 3, 2]} label="Decisions, 8 weeks" />)
    expect(container.querySelector("polyline")?.getAttribute("points")?.split(" ")).toHaveLength(3)
    expect(container.querySelector("circle")).toBeTruthy()
  })

  describe("edge cases", () => {
    it("handles a single point and an all-zero series", () => {
      const single = render(<Sparkline values={[5]} label="one" />)
      expect(single.container.querySelector("polyline")).toBeNull()
      expect(single.container.querySelector("circle")).toBeTruthy()
      cleanup()
      const flat = render(<Sparkline values={[0, 0, 0]} label="flat" />)
      expect(flat.container.querySelector("polyline")).toBeTruthy()
    })

    it("renders nothing but the frame for no values", () => {
      const { container } = render(<Sparkline values={[]} label="none" />)
      expect(container.querySelector("circle")).toBeNull()
    })
  })
})
