import type { ApiEnvelope } from "./types"

export interface ChoiceOption {
  id: string
  label: string
}

export interface ChoicePart {
  part: string
  label: string
  options: ChoiceOption[]
}

export interface ExamSource {
  videoId: string
  start?: number
  end?: number
}

// One or more lyric renderings that all sync to the same video clock. A-vs-B
// tests carry two (played side by side against one video); most carry one.
export interface ExamRendering {
  id: string
  label?: string
  ttml: string
}

export interface ClipAssets {
  source: ExamSource
  renderings: ExamRendering[]
}

export interface ScenarioStep {
  id: string
  kind: "dm" | "queue" | "channel"
  author?: string
  text?: string
  clip?: ClipAssets
  choices: ChoiceOption[]
}

export interface ExamClientQuestion {
  id: number
  type: "timing" | "mcq" | "scenario"
  category: string
  prompt: string
  assets?: { clip?: ClipAssets; image?: string }
  choices?: ChoicePart[]
  steps?: ScenarioStep[]
}

// One question's answer maps each part id to the chosen option id; the whole exam
// maps each question id to its answer.
export type QuestionAnswer = Record<string, string>
export type ExamAnswers = Record<string, QuestionAnswer>

export interface ExamSessionData {
  candidate: { displayName: string }
  questions: ExamClientQuestion[]
  timeLimitSec: number
  expiresAt: number
  savedAnswers: ExamAnswers
}

// The server error code drives which screen the SPA shows, so it is what we throw.
async function readErrorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: string; error?: string }
    return body.code ?? body.error ?? "REQUEST_FAILED"
  } catch {
    return "REQUEST_FAILED"
  }
}

async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readErrorCode(res))
}

export async function fetchExamSession(token: string): Promise<ExamSessionData> {
  const res = await fetch(`/exam/session?t=${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(await readErrorCode(res))
  const envelope = (await res.json()) as ApiEnvelope<ExamSessionData>
  if (!envelope.success) throw new Error("REQUEST_FAILED")
  return envelope.data
}

export async function autosaveAnswer(token: string, questionId: number, answer: QuestionAnswer): Promise<void> {
  await postJson("/exam/answer", { t: token, questionId, answer })
}

export async function submitExam(token: string, answers: ExamAnswers): Promise<void> {
  await postJson("/exam/submit", { t: token, answers })
}
