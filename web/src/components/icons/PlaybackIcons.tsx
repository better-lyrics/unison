import { cn } from "@/lib/cn"

const SWAP =
  "col-start-1 row-start-1 size-full transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:scale-100 motion-reduce:blur-none motion-reduce:transition-opacity motion-reduce:duration-150 motion-reduce:ease-linear"
const SHOWN = "scale-100 opacity-100 blur-none"
const HIDDEN = "scale-25 opacity-0 blur-[4px]"

export function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M5.669 4.76a1.469 1.469 0 0 1 2.04-1.177c1.062.454 3.442 1.533 6.462 3.276 3.021 1.744 5.146 3.267 6.069 3.958.788.591.79 1.763.001 2.356-.914.687-3.013 2.19-6.07 3.956-3.06 1.766-5.412 2.832-6.464 3.28-.906.387-1.92-.2-2.038-1.177-.138-1.142-.396-3.735-.396-7.237 0-3.5.257-6.092.396-7.235"
      />
    </svg>
  )
}

export function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M9 3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
      />
    </svg>
  )
}

export function PlayPauseIcon({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span className={cn("inline-grid size-[18px] shrink-0", className)}>
      <PlayIcon className={cn(SWAP, "translate-x-px", playing ? HIDDEN : SHOWN)} />
      <PauseIcon className={cn(SWAP, playing ? SHOWN : HIDDEN)} />
    </span>
  )
}
