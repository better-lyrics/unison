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
} from "@floating-ui/react"
import { cloneElement, type ReactElement, useState } from "react"

export function Tooltip({
  label,
  children,
}: {
  label: string
  children: ReactElement<Record<string, unknown>>
}) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const hover = useHover(context, { move: false, delay: { open: 120, close: 0 } })
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: "tooltip" })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role])

  return (
    <>
      {cloneElement(children, getReferenceProps({ ref: refs.setReference, ...children.props }))}
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 max-w-[220px] rounded-md border border-unison-border-strong bg-[#0b0a0e] px-2.5 py-1.5 text-[11px] font-medium leading-snug text-unison-text shadow-[0_10px_28px_rgba(0,0,0,0.55)]"
          >
            {label}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  )
}
