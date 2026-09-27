import { Bone } from "@/components/skeleton"
import type { ReactNode } from "react"
import { cardClass } from "./headings"

interface StatTileProps {
  label: string
  value: ReactNode | undefined
  unit: string
  foot: ReactNode
}

export function StatTile({ label, value, unit, foot }: StatTileProps) {
  return (
    <div className={`${cardClass} flex min-w-0 flex-col gap-3.5 p-5`}>
      <div className="text-xs text-unison-text-muted">{label}</div>
      {value === undefined ? (
        <Bone className="h-[26px] w-24" />
      ) : (
        <div className="flex items-baseline gap-2 font-mono text-[26px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
          {value}
          <small className="font-sans text-[13px] font-medium tracking-normal text-unison-text-muted">{unit}</small>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-unison-text-muted">{foot}</div>
    </div>
  )
}
