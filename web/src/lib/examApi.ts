import type { ApiEnvelope } from "./types"

export interface ChoiceOption {
  id: string
  label: string
  // Colours an action-style choice (a Discord action button); ignored by reply choices.
  intent?: "success" | "danger" | "primary" | "secondary"
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

// A scenario renders as a Discord simulation: a sequence of surfaces (a channel or
// a DM), each a thread of messages. One surface carries the composer, the reply
// picker that scores; the others are read-only context (the queue, the DM history).

export interface ScenarioEmbedField {
  name: string
  value: string
}

// A static, decorative lyric preview inside a bot embed (a video poster look, not a
// playable clip). The judged clip, if any, is a full ExamClip elsewhere.
export interface ScenarioEmbedPreviewLine {
  text: string
  dim?: boolean
}

export interface ScenarioEmbed {
  title?: string
  description?: string
  fields?: ScenarioEmbedField[]
  preview?: ScenarioEmbedPreviewLine[]
  footer?: string
}

export interface ScenarioMessage {
  author: string
  avatar: string
  timestamp?: string
  self?: boolean
  bot?: boolean
  text?: string
  embed?: ScenarioEmbed
}

// "reply" renders Discord reply cards (↵ send); "action" renders a row of Discord
// action buttons (Seal / Reject). Defaults to "reply".
export interface ScenarioComposer {
  style?: "reply" | "action"
  label?: string
  choices: ChoiceOption[]
}

// `id` doubles as the answer part id when the surface has a composer, so it must
// match the answer-key part id for that beat. Context surfaces omit the composer.
export interface ScenarioSurface {
  id: string
  kind: "channel" | "dm"
  title: string
  subtitle?: string
  messages: ScenarioMessage[]
  composer?: ScenarioComposer
}

export interface ExamClientQuestion {
  id: number
  type: "timing" | "mcq" | "scenario"
  category: string
  prompt: string
  assets?: { clip?: ClipAssets; image?: string }
  choices?: ChoicePart[]
  steps?: ScenarioSurface[]
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
  // Epoch seconds when the candidate first clicked Begin, or null before then. Drives
  // resume: a non-null value means the exam is underway, so reopening skips the intro
  // and continues the same countdown.
  examStartedAt: number | null
  savedAnswers: ExamAnswers
  // One-shot scenario (capstone) question ids whose story has ended on a wrong commit.
  // The client stops revealing further beats for these, and it survives a reload.
  terminatedQuestionIds: number[]
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

export async function beginExam(token: string): Promise<number> {
  const res = await fetch("/exam/begin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ t: token }),
  })
  if (!res.ok) throw new Error(await readErrorCode(res))
  const envelope = (await res.json()) as ApiEnvelope<{ examStartedAt: number }>
  if (!envelope.success) throw new Error("REQUEST_FAILED")
  return envelope.data.examStartedAt
}

// Returns whether this commit ended a one-shot scenario (a wrong capstone beat). For
// ordinary questions the server omits the flag, so this is simply false.
export async function autosaveAnswer(
  token: string,
  questionId: number,
  answer: QuestionAnswer,
): Promise<{ terminated: boolean }> {
  const res = await fetch("/exam/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ t: token, questionId, answer }),
  })
  if (!res.ok) throw new Error(await readErrorCode(res))
  const body = (await res.json()) as { success: boolean; data?: { terminated?: boolean } }
  return { terminated: Boolean(body.data?.terminated) }
}

export async function submitExam(token: string, answers: ExamAnswers): Promise<void> {
  await postJson("/exam/submit", { t: token, answers })
}
