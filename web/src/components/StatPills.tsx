import type { Format } from "@number-flow/react"
import { IconArrowBigUpFilled, IconFileMusicFilled, IconTrophyFilled } from "@tabler/icons-react"
import type { ComponentType } from "react"
import { OdometerNumber } from "@/components/OdometerNumber"

interface StatPillsProps {
  score: number
  submissions: number
  upvotes: number
}

interface Stat {
  key: string
  label: string
  value: number
  icon: ComponentType<{ className?: string; stroke?: number }>
  format?: Format
}

export function StatPills({ score, submissions, upvotes }: StatPillsProps) {
  const stats: Stat[] = [
    { key: "score", label: "Score", value: score, icon: IconTrophyFilled, format: { maximumFractionDigits: 1 } },
    { key: "submissions", label: "Submissions", value: submissions, icon: IconFileMusicFilled },
    { key: "upvotes", label: "Upvotes", value: upvotes, icon: IconArrowBigUpFilled },
  ]

  return (
    <div className="flex flex-wrap gap-3">
      {stats.map(({ key, label, value, icon: Icon, format }) => (
        <div
          key={key}
          data-testid={`stat-${key}`}
          className="flex items-center gap-3 rounded-full bg-[rgba(255,255,255,0.02)] py-2.5 pr-4 pl-2.5"
        >
          <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-[rgba(255,200,61,0.12)]">
            <Icon className="size-4 text-unison-medal-gold" />
          </span>
          <OdometerNumber
            value={value}
            format={format}
            className="font-mono text-base font-bold tracking-[-0.01em] text-unison-text"
          />
          <span className="text-xs text-unison-text-muted">{label}</span>
        </div>
      ))}
    </div>
  )
}
