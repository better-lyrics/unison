import type { ReactNode } from "react"
import { BetterLyricsLogo } from "@/components/BetterLyricsLogo"

function PulseDots({ pulsing }: { pulsing: boolean }) {
  return (
    <span className={`link-pulse${pulsing ? "" : " link-pulse--static"}`} aria-hidden="true">
      <span className="link-pulse-dot" />
      <span className="link-pulse-dot" />
      <span className="link-pulse-dot" />
    </span>
  )
}

const tileClass =
  "grid size-12 shrink-0 place-items-center rounded-2xl border border-unison-border bg-unison-bg-elevated"

export function LogoPair({ partner, pulsing = false }: { partner: ReactNode; pulsing?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={tileClass}>
        <BetterLyricsLogo size={28} />
      </span>
      <PulseDots pulsing={pulsing} />
      <span className={tileClass}>{partner}</span>
    </div>
  )
}
