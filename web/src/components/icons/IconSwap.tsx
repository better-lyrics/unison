import type { ReactNode } from "react"
import { cn } from "@/lib/cn"

const SWAP =
  "col-start-1 row-start-1 grid size-full place-items-center transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:scale-100 motion-reduce:blur-none motion-reduce:transition-opacity motion-reduce:duration-150 motion-reduce:ease-linear"
const SHOWN = "scale-100 opacity-100 blur-none"
const HIDDEN = "scale-25 opacity-0 blur-[4px]"

export function IconSwap({
  swapped,
  from,
  to,
  className,
}: {
  swapped: boolean
  from: ReactNode
  to: ReactNode
  className?: string
}) {
  return (
    <span aria-hidden="true" className={cn("inline-grid shrink-0", className)}>
      <span className={cn(SWAP, swapped ? HIDDEN : SHOWN)}>{from}</span>
      <span className={cn(SWAP, swapped ? SHOWN : HIDDEN)}>{to}</span>
    </span>
  )
}
