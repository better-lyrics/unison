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

// Lyric renderings that share one video clock; A-vs-B carries two, most carry one.
export interface ExamRendering {
  id: string
  label?: string
  ttml: string
}

export interface ClipAssets {
  source: ExamSource
  renderings: ExamRendering[]
}

// A scenario is a sequence of Discord surfaces; one carries the composer, the rest are context.

export interface ScenarioEmbedField {
  name: string
  value: string
}

// A decorative lyric preview inside a bot embed, not a playable clip.
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

// "reply" renders Discord reply cards; "action" renders action buttons. Defaults to "reply".
export interface ScenarioComposer {
  style?: "reply" | "action"
  label?: string
  choices: ChoiceOption[]
}

// id doubles as the answer part id when the surface has a composer; context surfaces omit it.
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

// A question's answer maps part id to option id; the exam maps question id to its answer.
export type QuestionAnswer = Record<string, string>
export type ExamAnswers = Record<string, QuestionAnswer>

export interface ExamSessionData {
  candidate: { displayName: string }
  questions: ExamClientQuestion[]
  timeLimitSec: number
  expiresAt: number
  // Epoch seconds of the first Begin, or null; non-null means the exam is underway (drives resume).
  examStartedAt: number | null
  savedAnswers: ExamAnswers
  // Capstone question ids whose story ended on a wrong commit; the client stops revealing beats.
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

// Returns whether this commit ended a one-shot scenario; the server omits the flag otherwise.
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
