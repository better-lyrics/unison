import type { ExamClientQuestion } from "@/lib/examApi"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./ExamClip", () => ({
  ExamClip: ({ clip }: { clip: { id: string } }) => <div data-testid="exam-clip">{clip.id}</div>,
}))

import { QuestionView } from "./QuestionView"

afterEach(cleanup)

const timing: ExamClientQuestion = {
  id: 1,
  type: "timing",
  category: "seal-or-not",
  prompt: "Is this seal-worthy?",
  assets: { clips: [{ id: "main", ttml: "<tt/>", source: { videoId: "abc" } }] },
  choices: [
    {
      part: "verdict",
      label: "Your verdict",
      options: [
        { id: "seal", label: "Seal" },
        { id: "no", label: "Do not seal" },
      ],
    },
    { part: "reason", label: "What holds it back?", options: [{ id: "timing", label: "Timing drifts" }] },
  ],
}

const scenario: ExamClientQuestion = {
  id: 2,
  type: "scenario",
  category: "capstone",
  prompt: "Handle the pushback",
  steps: [
    {
      id: "beat1",
      kind: "dm",
      author: "submitter",
      text: "so much for supporting small artists",
      choices: [
        { id: "hold", label: "Hold the standard kindly" },
        { id: "cave", label: "Approve to avoid conflict" },
      ],
    },
  ],
}

describe("QuestionView", () => {
  it("renders a timing clip and both choice parts", () => {
    render(<QuestionView question={timing} answer={{}} onChange={() => {}} />)
    expect(screen.getByTestId("exam-clip").textContent).toBe("main")
    expect(screen.getByText("Your verdict")).toBeTruthy()
    expect(screen.getByText("What holds it back?")).toBeTruthy()
  })

  it("reports the chosen verdict via onChange with the part id", () => {
    const onChange = vi.fn()
    render(<QuestionView question={timing} answer={{}} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText("Do not seal"))
    expect(onChange).toHaveBeenCalledWith("verdict", "no")
  })

  it("renders a scenario beat as a mock-Discord message with reply choices", () => {
    const onChange = vi.fn()
    render(<QuestionView question={scenario} answer={{}} onChange={onChange} />)
    expect(screen.getByText("Direct message")).toBeTruthy()
    expect(screen.getByText("submitter")).toBeTruthy()
    expect(screen.getByText("so much for supporting small artists")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Hold the standard kindly"))
    expect(onChange).toHaveBeenCalledWith("beat1", "hold")
  })
})
