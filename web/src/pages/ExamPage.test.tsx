import type { ExamSessionData } from "@/lib/examApi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetchExamSession = vi.fn()
const autosaveAnswer = vi.fn()
const submitExam = vi.fn()
vi.mock("@/lib/examApi", () => ({
  fetchExamSession: (...a: unknown[]) => fetchExamSession(...a),
  autosaveAnswer: (...a: unknown[]) => autosaveAnswer(...a),
  submitExam: (...a: unknown[]) => submitExam(...a),
}))

vi.mock("@/components/exam/ExamClip", () => ({
  ExamClip: ({ clip }: { clip: { id: string } }) => <div data-testid="exam-clip">{clip.id}</div>,
}))

import { ExamPage } from "./ExamPage"

function mcq(id: number, prompt: string): ExamSessionData["questions"][number] {
  return {
    id,
    type: "mcq",
    category: "pick-better",
    prompt,
    choices: [
      {
        part: "pick",
        label: "Which is better?",
        options: [
          { id: "a", label: `Option A ${id}` },
          { id: "b", label: `Option B ${id}` },
        ],
      },
    ],
  }
}

function session(overrides: Partial<ExamSessionData> = {}): ExamSessionData {
  return {
    candidate: { displayName: "Nova" },
    questions: [mcq(1, "Pick the better rendering"), mcq(2, "Which sync tracks the vocal?")],
    timeLimitSec: 1500,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    savedAnswers: {},
    ...overrides,
  }
}

function renderExam(entry = "/exam?t=tok") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/exam" element={<ExamPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  autosaveAnswer.mockResolvedValue(undefined)
  submitExam.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe("ExamPage", () => {
  describe("error paths", () => {
    it("shows an invalid-link screen when the token is missing", async () => {
      renderExam("/exam")
      expect(await screen.findByText("This exam link isn't valid")).toBeTruthy()
      expect(fetchExamSession).not.toHaveBeenCalled()
    })

    it("maps an expired token to the expired screen", async () => {
      fetchExamSession.mockRejectedValue(new Error("EXAM_TOKEN_EXPIRED"))
      renderExam()
      expect(await screen.findByText("This exam link has expired")).toBeTruthy()
    })

    it("maps an already-submitted token to the submitted screen", async () => {
      fetchExamSession.mockRejectedValue(new Error("EXAM_ALREADY_SUBMITTED"))
      renderExam()
      expect(await screen.findByText("You've already submitted this exam")).toBeTruthy()
    })
  })

  describe("happy path", () => {
    it("walks intro to submission, autosaving and hiding any score", async () => {
      fetchExamSession.mockResolvedValue(session())
      renderExam()

      expect(await screen.findByText("Council entry exam")).toBeTruthy()
      expect(screen.getByText(/Welcome, Nova/)).toBeTruthy()

      fireEvent.click(screen.getByRole("button", { name: "Begin" }))
      expect(screen.getByText("Question 1 of 2")).toBeTruthy()

      fireEvent.click(screen.getByLabelText("Option A 1"))
      await waitFor(() => expect(autosaveAnswer).toHaveBeenCalledWith("tok", 1, { pick: "a" }))

      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      expect(screen.getByText("Question 2 of 2")).toBeTruthy()

      fireEvent.click(screen.getByRole("button", { name: /Review/ }))
      expect(screen.getByText("Ready to submit?")).toBeTruthy()
      expect(screen.getByText(/answered 1 of 2/)).toBeTruthy()

      fireEvent.click(screen.getByRole("button", { name: "Submit exam" }))
      expect(await screen.findByText("Submitted")).toBeTruthy()
      expect(submitExam).toHaveBeenCalledWith("tok", { "1": { pick: "a" } })
      // never a numeric score anywhere on the closing screen
      expect(screen.queryByText(/\d+\s*\/\s*\d+/)).toBeNull()
    })

    it("lets the candidate go back to a previous question", async () => {
      fetchExamSession.mockResolvedValue(session())
      renderExam()
      fireEvent.click(await screen.findByRole("button", { name: "Begin" }))
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      expect(screen.getByText("Question 2 of 2")).toBeTruthy()
      fireEvent.click(screen.getByRole("button", { name: "Previous" }))
      expect(screen.getByText("Question 1 of 2")).toBeTruthy()
    })
  })

  describe("resume", () => {
    it("rehydrates saved answers so a returning candidate keeps progress", async () => {
      fetchExamSession.mockResolvedValue(session({ savedAnswers: { "1": { pick: "b" } } }))
      renderExam()
      fireEvent.click(await screen.findByRole("button", { name: "Begin" }))
      expect((screen.getByLabelText("Option B 1") as HTMLInputElement).checked).toBe(true)
      expect((screen.getByLabelText("Option A 1") as HTMLInputElement).checked).toBe(false)
    })
  })
})
