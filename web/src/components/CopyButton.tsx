import { IconCheck, IconCopy, IconX } from "@tabler/icons-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/cn"

type CopyState = "idle" | "copied" | "failed"

const RESET_MS: Record<Exclude<CopyState, "idle">, number> = {
  copied: 1500,
  failed: 2500,
}

const LABEL: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied!",
  failed: "Copy failed",
}

interface CopyButtonProps {
  text: string
  className?: string
  iconClassName?: string
  withText?: boolean
}

export function CopyButton({ text, className, iconClassName = "size-4", withText = false }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  const scheduleReset = useCallback((next: Exclude<CopyState, "idle">) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (mountedRef.current) setState("idle")
    }, RESET_MS[next])
  }, [])

  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard

  const handleClick = useCallback(() => {
    if (!navigator.clipboard) return
    navigator.clipboard.writeText(text).then(
      () => {
        if (!mountedRef.current) return
        setState("copied")
        scheduleReset("copied")
      },
      () => {
        if (!mountedRef.current) return
        setState("failed")
        scheduleReset("failed")
      },
    )
  }, [text, scheduleReset])

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canCopy}
      aria-label="Copy lyrics body to clipboard"
      aria-live="polite"
      title="Copy lyrics"
      className={cn(
        className,
        !canCopy && "cursor-not-allowed opacity-60",
        state === "idle" && "text-unison-text-secondary",
        state === "copied" && "text-green-500",
        state === "failed" && "text-amber-500",
      )}
    >
      {state === "copied" ? (
        <IconCheck className={iconClassName} stroke={1.75} />
      ) : state === "failed" ? (
        <IconX className={iconClassName} stroke={1.75} />
      ) : (
        <IconCopy className={iconClassName} stroke={1.75} />
      )}
      <span className={withText ? undefined : "sr-only"}>{LABEL[state]}</span>
    </button>
  )
}
