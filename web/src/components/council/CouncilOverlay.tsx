import { cn } from "@/lib/cn"
import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react"
import type { MutableRefObject, ReactNode } from "react"

interface CouncilOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  initialFocus?: MutableRefObject<HTMLElement | null>
  className?: string
  children: ReactNode
}

export function CouncilOverlay({ open, onOpenChange, label, initialFocus, className, children }: CouncilOverlayProps) {
  const { refs, context } = useFloating({ open, onOpenChange })
  const dismiss = useDismiss(context, { outsidePressEvent: "mousedown" })
  const role = useRole(context, { role: "dialog" })
  const { getFloatingProps } = useInteractions([dismiss, role])
  if (!open) return null
  return (
    <FloatingPortal>
      <FloatingOverlay lockScroll className="z-50 bg-[rgba(8,7,10,0.6)] backdrop-blur-[2px]">
        <FloatingFocusManager context={context} initialFocus={initialFocus} returnFocus>
          <div
            ref={refs.setFloating}
            aria-label={label}
            aria-modal="true"
            {...getFloatingProps()}
            className={cn(
              "fixed left-1/2 z-[55] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden outline-none rounded-xl border border-unison-border bg-unison-bg-elevated shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] motion-safe:animate-[bar-in_220ms_cubic-bezier(0.2,0,0,1)_both]",
              className,
            )}
          >
            {children}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  )
}
