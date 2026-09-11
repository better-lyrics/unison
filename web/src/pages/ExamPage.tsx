import { EmptyState } from "@/components/EmptyState"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { CountdownTimer } from "@/components/exam/CountdownTimer"
import { QuestionView } from "@/components/exam/QuestionView"
import { examButtonPrimary, examButtonSecondary } from "@/components/exam/exam-ui"
import { panelClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import { type ExamAnswers, autosaveAnswer, beginExam, fetchExamSession, submitExam } from "@/lib/examApi"
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
    hint: "The Council takes it from here, and if you're in, you'll hear back in Discord.",
  },
  REQUEST_FAILED: {
    title: "Something went wrong",
    hint: "Try reloading the page.",
  },
}

function errorCopy(code: string) {
  return ERROR_COPY[code] ?? ERROR_COPY.REQUEST_FAILED
}

const ALREADY_SUBMITTED_ART = [
  "https://cdn.betterlyrics.org/dog-butterfly.gif",
  "https://cdn.betterlyrics.org/nothing-ever-happens.gif",
  "https://cdn.betterlyrics.org/wilson.jpeg",
]

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
  const [terminated, setTerminated] = useState<Set<number>>(new Set())
  const [commitPending, setCommitPending] = useState(false)
  const [index, setIndex] = useState(0)
  const [endAt, setEndAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [submittedArt] = useState(
    () => ALREADY_SUBMITTED_ART[Math.floor(Math.random() * ALREADY_SUBMITTED_ART.length)],
  )
  const seeded = useRef(false)

  useEffect(() => {
    if (!query.data || seeded.current) return
    const data = query.data
    const saved = data.savedAnswers ?? {}
    setAnswers(saved)
    setTerminated(new Set(data.terminatedQuestionIds ?? []))
    if (data.examStartedAt != null) {
      setEndAt((data.examStartedAt + data.timeLimitSec) * 1000)
      const firstUnanswered = data.questions.findIndex((q) => saved[String(q.id)] === undefined)
      setIndex(firstUnanswered === -1 ? Math.max(0, data.questions.length - 1) : firstUnanswered)
      setPhase("questions")
    }
    seeded.current = true
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

  const begin = useMutation({ mutationFn: () => beginExam(token) })

  const submit = useMutation({
    mutationFn: () => submitExam(token, answers),
    onSuccess: () => setPhase("submitted"),
  })

  const handleChange = useCallback(
    (questionId: number, part: string, optionId: string) => {
      const key = String(questionId)
      const merged = { ...(answers[key] ?? {}), [part]: optionId }
      setAnswers((prev) => ({ ...prev, [key]: merged }))
      const isCapstone = query.data?.questions.find((q) => q.id === questionId)?.category === "capstone"
      if (isCapstone) {
        setCommitPending(true)
        autosave
          .mutateAsync({ questionId, answer: merged })
          .then((res) => {
            if (res.terminated) setTerminated((prev) => new Set(prev).add(questionId))
          })
          .catch(() => {})
          .finally(() => setCommitPending(false))
      } else {
        autosave.mutate({ questionId, answer: merged })
      }
    },
    [answers, autosave, query.data],
  )

  if (!token || query.isError) {
    const code = !token ? "EXAM_TOKEN_INVALID" : query.error instanceof Error ? query.error.message : "REQUEST_FAILED"
    const copy = errorCopy(code)
    if (code === "EXAM_ALREADY_SUBMITTED") {
      return (
        <div className={cn(panelClass, "mx-auto max-w-2xl space-y-4 p-8 text-center")}>
          <img
            src={submittedArt}
            alt=""
            className="mx-auto w-48 rounded-lg outline outline-1 -outline-offset-1 outline-white/10"
          />
          <h1 className="text-lg font-semibold text-unison-text">{copy.title}</h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-unison-text-secondary">{copy.hint}</p>
        </div>
      )
    }
    return <EmptyState title={copy.title} hint={copy.hint} />
  }

  if (query.isLoading || !query.data) return <LoadingPlaceholder rows={5} />

  const { candidate, questions, timeLimitSec } = query.data
  const total = questions.length
  const remaining = endAt ? Math.max(0, Math.floor((endAt - now) / 1000)) : null

  if (phase === "submitted") {
    return (
      <div className={cn(panelClass, "mx-auto max-w-2xl space-y-4 p-8 text-center")}>
        <img
          src="https://cdn.betterlyrics.org/impressed.gif"
          alt=""
          className="mx-auto w-48 rounded-lg outline outline-1 -outline-offset-1 outline-white/10"
        />
        <h1 className="text-lg font-semibold text-unison-text">Exam submitted</h1>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-unison-text-secondary">
          Nice work, {candidate.displayName}! That's the whole thing. The Council takes it from here, and if you're
          in, you'll hear back in Discord. You can close this tab.
        </p>
      </div>
    )
  }

  if (phase === "intro") {
    return (
      <div className={cn(panelClass, "mx-auto max-w-2xl space-y-5 p-6")}>
        <h1 className="text-lg font-semibold text-unison-text">Council entry exam</h1>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          Welcome, {candidate.displayName}! This exam tests your ability to cherry-pick good lyrics from great ones, and
          whether you have what it takes to be a Council member. A seal means{" "}
          <em className="font-medium text-unison-text">exceptional</em>, not just pretty good, so when in doubt, do not
          seal.
        </p>
        <p className="text-sm">
          <a
            href="https://composer.betterlyrics.org/guides/lyric-best-practices"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-unison-text underline underline-offset-4 transition-colors hover:text-unison-text-secondary"
          >
            Brush up before you start
          </a>
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-unison-text-secondary">
          <li>You have {Math.round(timeLimitSec / 60)} minutes. The timer is a guide, not a cutoff.</li>
          <li>Your answers save as you go, so a refresh won't lose progress.</li>
          <li>
            <strong className="font-semibold text-unison-text">You can only take this once.</strong>
          </li>
          <li>
            <strong className="font-semibold text-unison-text">Don't share the questions.</strong> Leaking exam
            questions anywhere is an instant, permanent ban.
          </li>
        </ul>
        <p className="text-sm text-unison-text-secondary">Good luck!</p>
        <button
          type="button"
          className={examButtonPrimary}
          onClick={() => {
            setEndAt(Date.now() + timeLimitSec * 1000)
            setPhase("questions")
            begin.mutate()
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
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          You've answered {answeredCount} of {total}. Once you submit, you can't change your answers, and Council admins
          review from there.
        </p>
        {submit.isError ? (
          <p className="text-sm text-unison-warn">
            {errorCopy(submit.error instanceof Error ? submit.error.message : "REQUEST_FAILED").title}. Try again.
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <button type="button" className={examButtonSecondary} onClick={() => setPhase("questions")}>
            Back
          </button>
          <button
            type="button"
            className={examButtonPrimary}
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
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs tabular-nums text-unison-text-muted">
          Question {index + 1} of {total}
        </span>
        {remaining !== null ? <CountdownTimer seconds={remaining} /> : null}
      </div>

      {question ? (
        <div className={cn(panelClass, "p-6")}>
          <QuestionView
            question={question}
            answer={answers[String(question.id)] ?? {}}
            onChange={(part, optionId) => handleChange(question.id, part, optionId)}
            candidateName={candidate.displayName}
            terminated={terminated.has(question.id) || commitPending}
          />
        </div>
      ) : (
        <EmptyState title="No questions" hint="This exam has no questions yet." />
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          className={examButtonSecondary}
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          Previous
        </button>
        {isLast ? (
          <button type="button" className={examButtonPrimary} onClick={() => setPhase("confirm")}>
            Review &amp; submit
          </button>
        ) : (
          <button
            type="button"
            className={examButtonPrimary}
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          >
            Next
          </button>
        )}
      </div>
    </div>
  )
}
