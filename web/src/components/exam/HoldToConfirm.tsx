import { cn } from "@/lib/cn"
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react"

// A press-and-hold control: the action fires only after the pointer (or Space/Enter)
// is held for `holdMs`. Releasing early cancels. Used for the one-shot capstone so a
// final choice can never be committed by an accidental tap.
export function HoldToConfirm({
  onConfirm,
  className,
  children,
  holdMs = 700,
  disabled = false,
}: {
  onConfirm: () => void
  className?: string
  children: ReactNode
  holdMs?: number
  disabled?: boolean
}) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = undefined
  }
  const begin = () => {
    if (disabled || timer.current) return
    setHolding(true)
    timer.current = setTimeout(() => {
      clear()
      setHolding(false)
      onConfirm()
    }, holdMs)
  }
  const cancel = () => {
    clear()
    setHolding(false)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return (
    <button
      type="button"
      disabled={disabled}
      className={cn("ds-hold", holding && "is-holding", className)}
      style={{ "--ds-hold-ms": `${holdMs}ms` } as CSSProperties}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault()
          begin()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") cancel()
      }}
    >
      <span className="ds-hold-fill" aria-hidden="true" />
      <span className="ds-hold-label">{children}</span>
    </button>
  )
}
