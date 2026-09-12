import { IconCheck, IconCopy, IconX } from "@tabler/icons-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/cn"
import { iconSwapVariants, labelSwapVariants, LAYOUT_TRANSITION, SWAP_TRANSITION } from "@/lib/motion-variants"

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

const ICON: Record<CopyState, typeof IconCopy> = {
  idle: IconCopy,
  copied: IconCheck,
  failed: IconX,
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

  const Icon = ICON[state]

  return (
    <MotionConfig reducedMotion="user">
      <motion.button
        layout
        type="button"
        onClick={handleClick}
        disabled={!canCopy}
        aria-label="Copy lyrics body to clipboard"
        aria-live="polite"
        title="Copy lyrics"
        style={{ borderRadius: 6 }}
        transition={{ layout: LAYOUT_TRANSITION }}
        className={cn(
          className,
          "relative cursor-pointer whitespace-nowrap",
          !canCopy && "cursor-not-allowed opacity-60",
          state === "copied" &&
            "border-green-500/60 bg-green-500/10 text-green-300 hover:border-green-500/60 hover:bg-green-500/10 hover:text-green-300",
          state === "failed" &&
            "border-amber-500/60 bg-amber-500/10 text-amber-300 hover:border-amber-500/60 hover:bg-amber-500/10 hover:text-amber-300",
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={state}
            layout
            variants={iconSwapVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={SWAP_TRANSITION}
            className="inline-flex"
          >
            <Icon className={iconClassName} stroke={1.75} />
          </motion.span>
        </AnimatePresence>
        {withText ? (
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={LABEL[state]}
              layout
              variants={labelSwapVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={SWAP_TRANSITION}
            >
              {LABEL[state]}
            </motion.span>
          </AnimatePresence>
        ) : (
          <span className="sr-only">{LABEL[state]}</span>
        )}
      </motion.button>
    </MotionConfig>
  )
}
