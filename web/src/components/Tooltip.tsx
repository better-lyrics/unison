import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react"
import { useReducedMotion } from "motion/react"
import { cloneElement, type ReactElement, type ReactNode, useState } from "react"
import { cn } from "@/lib/cn"
import { tooltipSurfaceClass } from "./ui"

const TOOLTIP_DELAY_MS = 80

export function Tooltip({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactElement<Record<string, unknown>>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const hover = useHover(context, { move: false, delay: { open: TOOLTIP_DELAY_MS } })
  const still = useReducedMotion()
  const { isMounted, styles } = useTransitionStyles(context, {
    duration: { open: 150, close: 50 },
    initial: still ? { opacity: 0 } : { opacity: 0, transform: "scale(0.98)" },
    common: { transitionTimingFunction: "ease-out" },
  })
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: "tooltip" })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role])

  return (
    <>
      {cloneElement(children, getReferenceProps({ ref: refs.setReference, ...children.props }))}
      {isMounted ? (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-50">
            <div style={styles} className={cn("max-w-[220px]", tooltipSurfaceClass, className)}>
              {label}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  )
}
