import type { ExamClientQuestion } from "@/lib/examApi"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./ExamClip", () => ({
  ExamClip: ({ clip }: { clip: { source: { videoId: string }; renderings: { id: string }[] } }) => (
    <div data-testid="exam-clip" data-renderings={clip.renderings.length}>
      {clip.source.videoId}
    </div>
  ),
}))

import { QuestionView } from "./QuestionView"

afterEach(cleanup)

const timing: ExamClientQuestion = {
  id: 1,
  type: "timing",
  category: "seal-or-not",
  prompt: "Is this seal-worthy?",
  assets: {
    clip: { source: { videoId: "abc" }, renderings: [{ id: "main", ttml: "<tt/>" }] },
  },
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
    const clip = screen.getByTestId("exam-clip")
    expect(clip.textContent).toBe("abc")
    expect(clip.getAttribute("data-renderings")).toBe("1")
    expect(screen.getByText("Your verdict")).toBeTruthy()
    expect(screen.getByText("What holds it back?")).toBeTruthy()
  })

  it("renders an A-vs-B clip with two renderings against one video", () => {
    const avsb: ExamClientQuestion = {
      id: 3,
      type: "timing",
      category: "a-vs-b",
      prompt: "Which sync is better?",
      assets: {
        clip: {
          source: { videoId: "vid" },
          renderings: [
            { id: "A", label: "Version A", ttml: "<tt/>" },
            { id: "B", label: "Version B", ttml: "<tt/>" },
          ],
        },
      },
      choices: [
        {
          part: "pick",
          label: "Which is better?",
          options: [
            { id: "A", label: "A" },
            { id: "B", label: "B" },
          ],
        },
      ],
    }
    render(<QuestionView question={avsb} answer={{}} onChange={() => {}} />)
    expect(screen.getByTestId("exam-clip").getAttribute("data-renderings")).toBe("2")
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
