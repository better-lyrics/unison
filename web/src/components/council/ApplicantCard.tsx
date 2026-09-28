import { AuthorBadges } from "@/components/AuthorBadges"
import { UserAvatar } from "@/components/UserAvatar"
import { buttonClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import type { ApplicantView, OpinionStance } from "@/lib/council-types"
import { formatElapsed } from "@/lib/format"
import { IconCheck, IconThumbDown, IconThumbUp } from "@tabler/icons-react"
import { useState } from "react"
import { cardClass } from "./headings"

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" })
const STACK_SIZE = 5

interface ApplicantCardProps {
  applicant: ApplicantView
  now: number
  admin: boolean
  busy: boolean
  onOpinion: (stance: OpinionStance | null) => void
  onDecision: (decision: "approve" | "reject") => void
}

export function ApplicantCard({ applicant, now, admin, busy, onOpinion, onDecision }: ApplicantCardProps) {
  const name = applicant.person?.displayName ?? applicant.displayName
  const failed = applicant.state === "failed"
  const max = applicant.maxScore ?? 100
  const score = applicant.score === null ? null : Math.round((applicant.score / max) * 100)
  const cutoff = applicant.cutoff === null ? null : Math.round((applicant.cutoff / max) * 100)
  const { support, object, notes, mine } = applicant.opinions
  const toggle = (stance: OpinionStance) => onOpinion(mine === stance ? null : stance)
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null)

  return (
    <article aria-label={name} className={cn(cardClass, "flex flex-col gap-[22px] p-6", failed && "opacity-70")}>
      <div className="flex items-center gap-3">
        <UserAvatar
          avatarUrl={applicant.person?.avatarUrl}
          keyId={applicant.keyId}
          className="size-11 shrink-0 rounded-full object-cover outline outline-1 -outline-offset-1 outline-white/10"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {name}
            {applicant.person ? <AuthorBadges {...applicant.person} /> : null}
          </div>
          <div className="mt-[3px] text-xs text-unison-text-muted">
            {applicant.submittedAt === null
              ? "Not submitted"
              : `Submitted ${formatElapsed(now - applicant.submittedAt)} ago`}
            {failed && applicant.retakeAt !== null
              ? ` · can retake in ${monthYear.format(applicant.retakeAt * 1000)}`
              : ""}
          </div>
        </div>
        {score === null ? null : (
          <b className="font-mono text-[30px] font-semibold tracking-[-0.02em] tabular-nums">{score}%</b>
        )}
      </div>

      {score === null ? null : (
        <div>
          <div
            role="meter"
            aria-label="Exam score"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={score}
            className="relative h-1.5 rounded-[3px] bg-white/[0.08]"
          >
            <i
              className={cn(
                "absolute inset-y-0 left-0 rounded-[3px]",
                failed ? "bg-[rgba(245,245,247,0.35)]" : "bg-linear-to-r from-[#ffb020] to-unison-medal-gold",
              )}
              style={{ width: `${score}%` }}
            />
            {cutoff === null ? null : (
              <s
                className="absolute -inset-y-[5px] w-0.5 rounded-[1px] bg-unison-text"
                style={{ left: `${cutoff}%` }}
              />
            )}
          </div>
          {cutoff === null ? null : (
            <div className="relative mt-2.5 h-3.5 font-mono text-[10px] leading-[14px] text-unison-text-muted">
              <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${cutoff}%` }}>
                cutoff {cutoff}%
              </span>
            </div>
          )}
        </div>
      )}

      {applicant.breakdown.length > 0 ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 text-xs">
          {applicant.breakdown.map((area) => (
            <div key={area.section} className="contents">
              <span className="text-unison-text-secondary">{area.section}</span>
              <span className="relative h-1 rounded-[2px] bg-white/[0.08]">
                <i
                  className="absolute inset-y-0 left-0 rounded-[2px] bg-council-edit"
                  style={{ width: `${area.max === 0 ? 0 : (area.score / area.max) * 100}%` }}
                />
              </span>
              <span className="font-mono text-[11px] text-unison-text-muted">
                {area.score}/{area.max}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {notes.map((note) => (
        <p
          key={note.by.keyId}
          className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs leading-normal text-unison-text-secondary"
        >
          <b className="font-medium text-unison-text">{note.by.displayName}:</b> {note.note}
        </p>
      ))}

      {failed ? (
        <p className="text-xs text-unison-text-muted">Below the cutoff. Shown for context only.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <OpinionButton
              stance="support"
              pressed={mine === "support"}
              count={support.length}
              onClick={() => toggle("support")}
            />
            <OpinionButton
              stance="object"
              pressed={mine === "object"}
              count={object.length}
              onClick={() => toggle("object")}
            />
            <span className="flex" aria-hidden>
              {[...support, ...object].slice(0, STACK_SIZE).map((person, i) => (
                <UserAvatar
                  key={person.keyId}
                  avatarUrl={person.avatarUrl}
                  keyId={person.keyId}
                  className={cn("size-[22px] rounded-full object-cover shadow-[0_0_0_2px_#121116]", i > 0 && "-ml-1.5")}
                  loading="lazy"
                />
              ))}
            </span>
          </div>
          {!admin ? null : confirming ? (
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className={buttonClass(confirming === "reject" ? "danger" : "primary", "sm")}
                onClick={() => {
                  setConfirming(null)
                  onDecision(confirming)
                }}
              >
                {confirming === "reject" ? "Reject" : "Approve"} {name}
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                className={buttonClass("ghost", "sm")}
                onClick={() => setConfirming("reject")}
              >
                Reject
              </button>
              <button
                type="button"
                disabled={busy}
                className={buttonClass("primary", "sm")}
                onClick={() => setConfirming("approve")}
              >
                <IconCheck aria-hidden className="size-3.5" stroke={1.75} />
                Approve and add to council
              </button>
            </div>
          )}
        </>
      )}
    </article>
  )
}

function OpinionButton({
  stance,
  pressed,
  count,
  onClick,
}: {
  stance: OpinionStance
  pressed: boolean
  count: number
  onClick: () => void
}) {
  const Icon = stance === "support" ? IconThumbUp : IconThumbDown
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-unison-text-secondary shadow-[inset_0_0_0_1px_var(--color-unison-border)] transition-[color,background-color,box-shadow,scale] duration-150 hover:bg-unison-bg-hover hover:text-unison-text active:scale-[0.96]",
        pressed &&
          stance === "support" &&
          "bg-[rgba(12,163,12,0.1)] text-[#86d98a] shadow-[inset_0_0_0_1px_rgba(12,163,12,0.4)] hover:bg-[rgba(12,163,12,0.14)] hover:text-[#86d98a]",
        pressed &&
          stance === "object" &&
          "bg-[rgba(245,166,35,0.1)] text-[#f7c46c] shadow-[inset_0_0_0_1px_rgba(245,166,35,0.4)] hover:bg-[rgba(245,166,35,0.14)] hover:text-[#f7c46c]",
      )}
    >
      <Icon aria-hidden className="size-3.5" stroke={1.5} />
      {stance === "support" ? "Support" : "Object"}
      <b className="font-mono font-medium">{count}</b>
    </button>
  )
}
