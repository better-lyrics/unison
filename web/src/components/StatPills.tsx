import { OdometerNumber } from "@/components/OdometerNumber"
import { cn } from "@/lib/cn"
import type { Format } from "@number-flow/react"
import { IconArrowBigUpFilled, IconFileMusicFilled, IconTrophyFilled } from "@tabler/icons-react"
import type { ComponentType } from "react"

interface StatPillsProps {
  score: number
  submissions: number
  upvotes: number
}

type PillIcon = ComponentType<{ className?: string; stroke?: number }>

const TONES = {
  gold: "bg-unison-medal-gold-wash text-unison-medal-gold",
  reject: "bg-[rgba(217,95,138,0.14)] text-council-reject-ink",
  edit: "bg-[rgba(111,122,240,0.16)] text-council-edit-ink",
  neutral: "bg-unison-surface text-unison-text-secondary",
}

interface StatPillProps {
  icon: PillIcon
  value: number
  label: string
  format?: Format
  suffix?: string
  tone?: keyof typeof TONES
  testId?: string
}

export function StatPill({ icon: Icon, value, label, format, suffix, tone = "gold", testId }: StatPillProps) {
  return (
    <div
      data-testid={testId}
      className="flex h-12 items-center gap-3 rounded-full bg-[rgba(255,255,255,0.02)] pr-4 pl-2.5 shadow-inset-rim"
    >
      <span className={cn("grid size-[30px] shrink-0 place-items-center rounded-full", TONES[tone])}>
        <Icon className="size-4" stroke={1.5} />
      </span>
      <span className="font-mono text-base font-bold tracking-[-0.01em] text-unison-text">
        <OdometerNumber value={value} format={format} />
        {suffix}
      </span>
      <span className="text-xs text-unison-text-muted">{label}</span>
    </div>
  )
}

export function StatPills({ score, submissions, upvotes }: StatPillsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <StatPill
        testId="stat-score"
        icon={IconTrophyFilled}
        value={score}
        label="Score"
        format={{ maximumFractionDigits: 1 }}
      />
      <StatPill testId="stat-submissions" icon={IconFileMusicFilled} value={submissions} label="Submissions" />
      <StatPill testId="stat-upvotes" icon={IconArrowBigUpFilled} value={upvotes} label="Upvotes" />
    </div>
  )
}
