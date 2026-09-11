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

// Fictional fixture only: no real prompt, submitter, reply copy, or answer key,
// so the committed test cannot leak any exam content.
const scenario: ExamClientQuestion = {
  id: 2,
  type: "scenario",
  category: "scenario",
  prompt: "Sample scenario prompt",
  steps: [
    {
      id: "beat-a",
      kind: "channel",
      title: "sample-channel",
      subtitle: "Context channel",
      messages: [
        {
          author: "SampleBot",
          avatar: "/pfp/butler.svg",
          bot: true,
          timestamp: "Today at 2:02 AM",
          embed: { title: "Sample embed", footer: "Sample footer." },
        },
      ],
    },
    {
      id: "beat-b",
      kind: "channel",
      title: "public-channel",
      subtitle: "Public",
      messages: [{ author: "sample_user", avatar: "/pfp/ape.webp", text: "sample message" }],
      composer: {
        label: "Choose your reply.",
        choices: [
          { id: "opt1", label: "Reply option one" },
          { id: "opt2", label: "Reply option two" },
        ],
      },
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

  it("renders a scenario as a Discord simulation and reports the reply with its surface id", () => {
    const onChange = vi.fn()
    render(<QuestionView question={scenario} answer={{}} onChange={onChange} />)
    expect(screen.getByText("sample-channel")).toBeTruthy()
    expect(screen.getByText("public-channel")).toBeTruthy()
    expect(screen.getByText("sample_user")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Reply option two"))
    expect(onChange).toHaveBeenCalledWith("beat-b", "opt2")
  })

  it("makes a capstone scenario one-shot: shows the finality warning and no plain radios", () => {
    const capstone: ExamClientQuestion = { ...scenario, id: 4, category: "capstone" }
    const { container } = render(<QuestionView question={capstone} answer={{}} onChange={() => {}} />)
    expect(screen.getByText(/whatever option you pick is final/i)).toBeTruthy()
    expect(container.querySelector(".ds-hold")).toBeTruthy()
    expect(container.querySelector("input[type=radio]")).toBeNull()
  })
})
