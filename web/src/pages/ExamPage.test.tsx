import type { ExamSessionData } from "@/lib/examApi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetchExamSession = vi.fn()
const autosaveAnswer = vi.fn()
const submitExam = vi.fn()
const beginExam = vi.fn()
vi.mock("@/lib/examApi", () => ({
  fetchExamSession: (...a: unknown[]) => fetchExamSession(...a),
  autosaveAnswer: (...a: unknown[]) => autosaveAnswer(...a),
  submitExam: (...a: unknown[]) => submitExam(...a),
  beginExam: (...a: unknown[]) => beginExam(...a),
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
    examStartedAt: null,
    savedAnswers: {},
    terminatedQuestionIds: [],
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
  autosaveAnswer.mockResolvedValue({ terminated: false })
  submitExam.mockResolvedValue(undefined)
  beginExam.mockResolvedValue(Math.floor(Date.now() / 1000))
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

    it("shows a random cdn image on the already-submitted screen", async () => {
      fetchExamSession.mockRejectedValue(new Error("EXAM_ALREADY_SUBMITTED"))
      const { container } = renderExam()
      expect(await screen.findByText("You've already submitted this exam")).toBeTruthy()
      const img = container.querySelector("img") as HTMLImageElement | null
      expect(img?.getAttribute("src")).toMatch(
        /^https:\/\/cdn\.betterlyrics\.org\/(dog-butterfly\.gif|nothing-ever-happens\.gif|wilson\.jpeg)$/,
      )
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
      expect(await screen.findByText("Exam submitted")).toBeTruthy()
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

    it("stamps the clock on Begin so a reload can resume", async () => {
      fetchExamSession.mockResolvedValue(session())
      renderExam()
      fireEvent.click(await screen.findByRole("button", { name: "Begin" }))
      await waitFor(() => expect(beginExam).toHaveBeenCalledWith("tok"))
    })

    it("skips the intro and lands on the first unanswered question when the clock is running", async () => {
      fetchExamSession.mockResolvedValue(
        session({
          examStartedAt: Math.floor(Date.now() / 1000) - 120,
          savedAnswers: { "1": { pick: "b" } },
        }),
      )
      renderExam()
      // No intro, no Begin: straight into the exam on question 2 (question 1 is answered).
      expect(await screen.findByText("Question 2 of 2")).toBeTruthy()
      expect(screen.queryByText("Council entry exam")).toBeNull()
      expect(screen.queryByRole("button", { name: "Begin" })).toBeNull()
    })

    it("resumes on the first question when nothing is answered yet", async () => {
      fetchExamSession.mockResolvedValue(session({ examStartedAt: Math.floor(Date.now() / 1000) - 30 }))
      renderExam()
      expect(await screen.findByText("Question 1 of 2")).toBeTruthy()
    })

    it("does not flash the next capstone beat while a wrong commit is still in flight", async () => {
      let resolveSave: (v: { terminated: boolean }) => void = () => {}
      autosaveAnswer.mockReturnValue(
        new Promise<{ terminated: boolean }>((r) => {
          resolveSave = r
        }),
      )
      const capstone: ExamSessionData["questions"][number] = {
        id: 7,
        type: "scenario",
        category: "capstone",
        prompt: "Capstone",
        steps: [
          {
            id: "queue",
            kind: "channel",
            title: "review-queue",
            messages: [{ author: "Butler", avatar: "/pfp/butler.svg", bot: true, embed: { title: "Queue" } }],
            composer: {
              style: "action",
              choices: [
                { id: "reject", label: "Reject", intent: "danger" },
                { id: "seal", label: "Seal", intent: "success" },
              ],
            },
          },
          {
            id: "dm",
            kind: "dm",
            title: "someone",
            messages: [{ author: "someone", avatar: "/pfp/ape.webp", text: "next beat" }],
            composer: { label: "Reply", choices: [{ id: "hold", label: "hold" }] },
          },
        ],
      }
      fetchExamSession.mockResolvedValue(
        session({ questions: [capstone], examStartedAt: Math.floor(Date.now() / 1000) - 30 }),
      )
      renderExam()
      const seal = (await screen.findByText("Seal")).closest("button") as HTMLButtonElement

      vi.useFakeTimers()
      fireEvent.pointerDown(seal)
      await act(async () => {
        vi.advanceTimersByTime(700)
      })
      vi.useRealTimers()

      // The wrong beat is committed locally but its verdict hasn't returned, so the
      // next beat must stay hidden instead of flashing during the round-trip.
      expect(screen.queryByText("next beat")).toBeNull()

      await act(async () => {
        resolveSave({ terminated: true })
      })
      expect(screen.queryByText("next beat")).toBeNull()
    })

    it("keeps a terminated capstone ended after a reload (survives refresh)", async () => {
      const capstone: ExamSessionData["questions"][number] = {
        id: 7,
        type: "scenario",
        category: "capstone",
        prompt: "Capstone",
        steps: [
          {
            id: "queue",
            kind: "channel",
            title: "review-queue",
            messages: [{ author: "Butler", avatar: "/pfp/butler.svg", bot: true, embed: { title: "Queue" } }],
            composer: {
              style: "action",
              choices: [
                { id: "reject", label: "Reject", intent: "danger" },
                { id: "seal", label: "Seal", intent: "success" },
              ],
            },
          },
          {
            id: "dm",
            kind: "dm",
            title: "someone",
            messages: [{ author: "someone", avatar: "/pfp/ape.webp", text: "next beat" }],
            composer: { label: "Reply", choices: [{ id: "hold", label: "hold" }] },
          },
        ],
      }
      fetchExamSession.mockResolvedValue(
        session({
          questions: [capstone],
          examStartedAt: Math.floor(Date.now() / 1000) - 60,
          savedAnswers: { "7": { queue: "seal" } },
          terminatedQuestionIds: [7],
        }),
      )
      renderExam()
      // Resumes straight into the ended capstone: the finality warning is up, the wrong
      // beat is locked, and the next beat ("next beat") is never revealed.
      expect(await screen.findByText(/whatever option you pick is final/i)).toBeTruthy()
      expect(screen.queryByText("next beat")).toBeNull()
    })
  })
})
