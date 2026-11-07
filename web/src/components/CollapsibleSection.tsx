import { IconChevronDown } from "@tabler/icons-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { cn } from "@/lib/cn"
import { scrollToStart } from "@/lib/scroll"
import "./profile.css"

interface CollapsibleSectionProps {
  title: string
  summary?: ReactNode
  defaultOpen?: boolean
  className?: string
  testId?: string
  revealRequest?: number
  children: ReactNode
}

export function CollapsibleSection({
  title,
  summary,
  defaultOpen = true,
  className,
  testId,
  revealRequest,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const sectionRef = useRef<HTMLElement>(null)
  const handledReveal = useRef(revealRequest)
  const bodyId = useId()

  useEffect(() => {
    if (!revealRequest || revealRequest === handledReveal.current) return
    handledReveal.current = revealRequest
    setOpen(true)
    scrollToStart(sectionRef.current)
  }, [revealRequest])

  return (
    <section ref={sectionRef} className={className} data-testid={testId}>
      <div className="flex items-center gap-3">
        <h2 className="m-0 min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
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
      <div className="t-acc" data-open={open}>
        <div id={bodyId} inert={!open} className="t-acc-panel">
          <div className="t-acc-panel-inner -m-1 p-1">
            {/* cs-reveal is applied once on mount so the entrance plays on load, not on every toggle. */}
            <div className="cs-reveal pt-5">{children}</div>
          </div>
        </div>
      </div>
    </section>
  )
}
