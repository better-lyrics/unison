import type { ReactNode } from "react"

interface LeaderboardSectionProps {
  title: string
  subtitle?: string
  children: ReactNode
}

export function LeaderboardSection({ title, subtitle, children }: LeaderboardSectionProps) {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-base font-semibold text-unison-text">{title}</h2>
        {subtitle ? <p className="text-xs text-unison-text-muted">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  )
}
