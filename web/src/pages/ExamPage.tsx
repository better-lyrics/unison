import { EmptyState } from "@/components/EmptyState"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { secondaryButtonClass } from "@/components/discord-ui"
import { QuestionView } from "@/components/exam/QuestionView"
import { panelClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import { type ExamAnswers, autosaveAnswer, fetchExamSession, submitExam } from "@/lib/examApi"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"

type Phase = "intro" | "questions" | "confirm" | "submitted"

const ERROR_COPY: Record<string, { title: string; hint: string }> = {
  EXAM_TOKEN_INVALID: {
    title: "This exam link isn't valid",
    hint: "Ask in Discord for a fresh link.",
  },
  EXAM_TOKEN_EXPIRED: {
    title: "This exam link has expired",
    hint: "Ask in Discord for a fresh link.",
  },
  EXAM_ALREADY_SUBMITTED: {
    title: "You've already submitted this exam",
    hint: "Council admins review from here. You'll hear back in Discord.",
  },
  REQUEST_FAILED: {
    title: "Something went wrong",
    hint: "Try reloading the page.",
  },
}

function errorCopy(code: string) {
  return ERROR_COPY[code] ?? ERROR_COPY.REQUEST_FAILED
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

const primaryButtonClass =
  "inline-flex cursor-pointer items-center justify-center rounded-md bg-unison-accent px-4 py-2.5 text-sm font-semibold text-unison-bg transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"

export function ExamPage() {
  const [params] = useSearchParams()
  const token = params.get("t") ?? ""

  const query = useQuery({
    queryKey: ["exam", "session", token],
    queryFn: () => fetchExamSession(token),
    enabled: token.length > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const [phase, setPhase] = useState<Phase>("intro")
  const [answers, setAnswers] = useState<ExamAnswers>({})
  const [index, setIndex] = useState(0)
  const [endAt, setEndAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const seeded = useRef(false)

  useEffect(() => {
    if (query.data && !seeded.current) {
      setAnswers(query.data.savedAnswers ?? {})
      seeded.current = true
    }
  }, [query.data])

  useEffect(() => {
    if (phase !== "questions") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [phase])

  const autosave = useMutation({
    mutationFn: ({ questionId, answer }: { questionId: number; answer: Record<string, string> }) =>
      autosaveAnswer(token, questionId, answer),
  })

  const submit = useMutation({
    mutationFn: () => submitExam(token, answers),
    onSuccess: () => setPhase("submitted"),
  })

  const handleChange = useCallback(
    (questionId: number, part: string, optionId: string) => {
      const key = String(questionId)
      const merged = { ...(answers[key] ?? {}), [part]: optionId }
      setAnswers((prev) => ({ ...prev, [key]: merged }))
      autosave.mutate({ questionId, answer: merged })
    },
    [answers, autosave],
  )

  if (!token || query.isError) {
    const code = !token ? "EXAM_TOKEN_INVALID" : query.error instanceof Error ? query.error.message : "REQUEST_FAILED"
    const copy = errorCopy(code)
    return <EmptyState title={copy.title} hint={copy.hint} />
  }

  if (query.isLoading || !query.data) return <LoadingPlaceholder rows={5} />

  const { candidate, questions, timeLimitSec } = query.data
  const total = questions.length
  const remaining = endAt ? Math.max(0, Math.floor((endAt - now) / 1000)) : null

  if (phase === "submitted") {
    return <EmptyState title="Submitted" hint="Council admins review from here. You'll hear back in Discord." />
  }

  if (phase === "intro") {
    return (
      <div className={cn(panelClass, "mx-auto max-w-2xl space-y-5 p-6")}>
        <h1 className="text-lg font-semibold text-unison-text">Council entry exam</h1>
        <p className="text-sm text-unison-text-secondary">
          Welcome, {candidate.displayName}. This exam tests one thing: telling good lyrics from great ones. Judge each
          clip on timing and taste. A seal means exceptional, not just pretty good, so when in doubt, do not seal.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-unison-text-secondary">
          <li>You have {Math.round(timeLimitSec / 60)} minutes. The timer is a guide, not a cutoff.</li>
          <li>Your answers save as you go, so a refresh won't lose progress.</li>
          <li>You can only take this once.</li>
        </ul>
        <button
          type="button"
          className={primaryButtonClass}
          onClick={() => {
            setEndAt(Date.now() + timeLimitSec * 1000)
            setPhase("questions")
          }}
        >
          Begin
        </button>
      </div>
    )
  }

  if (phase === "confirm") {
    const answeredCount = questions.filter((q) => answers[String(q.id)] !== undefined).length
    return (
      <div className={cn(panelClass, "mx-auto max-w-2xl space-y-5 p-6")}>
        <h1 className="text-lg font-semibold text-unison-text">Ready to submit?</h1>
        <p className="text-sm text-unison-text-secondary">
          You've answered {answeredCount} of {total}. Once you submit, you can't change your answers, and Council admins
          review from there.
        </p>
        {submit.isError ? (
          <p className="text-sm text-unison-warn">
            {errorCopy(submit.error instanceof Error ? submit.error.message : "REQUEST_FAILED").title}. Try again.
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <button type="button" className={secondaryButtonClass} onClick={() => setPhase("questions")}>
            Back
          </button>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Submitting…" : "Submit exam"}
          </button>
        </div>
      </div>
    )
  }

  const question = questions[index]
  const isLast = index === total - 1

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between text-xs text-unison-text-muted">
        <span>
          Question {index + 1} of {total}
        </span>
        {remaining !== null ? (
          <span aria-live="polite">{remaining === 0 ? "Time's up" : formatRemaining(remaining)}</span>
        ) : null}
      </div>

      {question ? (
        <div className={cn(panelClass, "p-6")}>
          <QuestionView
            question={question}
            answer={answers[String(question.id)] ?? {}}
            onChange={(part, optionId) => handleChange(question.id, part, optionId)}
          />
        </div>
      ) : (
        <EmptyState title="No questions" hint="This exam has no questions yet." />
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          Previous
        </button>
        {isLast ? (
          <button type="button" className={primaryButtonClass} onClick={() => setPhase("confirm")}>
            Review &amp; submit
          </button>
        ) : (
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          >
            Next
          </button>
        )}
      </div>
    </div>
  )
}
