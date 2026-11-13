import { BetterLyricsLogo } from "@/components/BetterLyricsLogo"
import { appTileClass } from "@/components/ui"
import type { ReactNode } from "react"

function PulseDots({ pulsing }: { pulsing: boolean }) {
  return (
    <span className={`link-pulse${pulsing ? "" : " link-pulse--static"}`} aria-hidden="true">
      <span className="link-pulse-dot" />
      <span className="link-pulse-dot" />
      <span className="link-pulse-dot" />
    </span>
  )
}

const tileClass = `${appTileClass} size-12`

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
