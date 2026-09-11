import { cn } from "@/lib/cn"
import NumberFlow from "@number-flow/react"
import { IconClock } from "@tabler/icons-react"

const PAD2 = { minimumIntegerDigits: 2 } as const

// mm:ss countdown; under a minute it shifts to the warn colour as a static urgency cue.
export function CountdownTimer({ seconds }: { seconds: number }) {
  const clamped = Math.max(0, seconds)
  const minutes = Math.floor(clamped / 60)
  const secs = clamped % 60
  const low = clamped <= 60

  return (
    <div
      aria-label={`${minutes} minutes ${secs} seconds remaining`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-sm tabular-nums transition-colors",
        low
          ? "border-unison-warn/40 bg-unison-warn/10 text-unison-warn"
          : "border-unison-border bg-unison-bg-elevated text-unison-text-secondary",
      )}
    >
      <IconClock className="size-3.5" stroke={2} aria-hidden />
      <span className="tracking-tight">
        <NumberFlow value={minutes} trend={-1} format={PAD2} />
        <span className="mx-px opacity-60">:</span>
        <NumberFlow value={secs} trend={-1} format={PAD2} />
      </span>
    </div>
  )
}
