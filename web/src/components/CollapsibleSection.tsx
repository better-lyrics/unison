import { IconChevronDown } from "@tabler/icons-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { cn } from "@/lib/cn"
import "./profile.css"

const COLLAPSE_MS = 300

interface CollapsibleSectionProps {
  title: string
  summary?: ReactNode
  defaultOpen?: boolean
  className?: string
  testId?: string
  children: ReactNode
}

export function CollapsibleSection({
  title,
  summary,
  defaultOpen = true,
  className,
  testId,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [height, setHeight] = useState<number | "auto">(defaultOpen ? "auto" : 0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const bodyId = useId()

  const clearPending = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    rafRef.current = null
    timerRef.current = null
  }

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const toggle = () => {
    const el = wrapRef.current
    if (!el) {
      setOpen((v) => !v)
      return
    }
    clearPending()
    if (open) {
      setHeight(el.scrollHeight)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => setHeight(0))
      })
      setOpen(false)
    } else {
      setHeight(el.scrollHeight)
      setOpen(true)
      timerRef.current = window.setTimeout(() => setHeight("auto"), COLLAPSE_MS)
    }
  }

  return (
    <section className={className} data-testid={testId}>
      <div className="flex items-center gap-3">
        <h2 className="m-0 min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
            className="group flex w-full cursor-pointer items-center gap-2 text-left"
          >
            <IconChevronDown
              aria-hidden
              stroke={2}
              className={cn(
                "size-4 shrink-0 text-unison-text-muted transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] group-hover:text-unison-text",
                open ? "" : "-rotate-90",
              )}
            />
            <span className="text-[17px] leading-7 font-bold tracking-[-0.01em] text-unison-text">{title}</span>
          </button>
        </h2>
        {summary ? <div className="shrink-0">{summary}</div> : null}
      </div>
      <div
        id={bodyId}
        ref={wrapRef}
        style={{ height: height === "auto" ? undefined : height, overflow: height === "auto" ? undefined : "hidden" }}
        className="transition-[height] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
      >
        {/* cs-reveal is applied once on mount so the entrance plays on load, not on every toggle. */}
        <div className="cs-reveal pt-5">{children}</div>
      </div>
    </section>
  )
}
