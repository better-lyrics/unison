import type { ReactNode } from "react"
import { Link } from "react-router-dom"

interface LeaderboardSectionProps {
  title: ReactNode
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}

export function LeaderboardSection({ title, subtitle, action, children }: LeaderboardSectionProps) {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-unison-text">{title}</h2>
          {subtitle ? <p className="text-xs text-unison-text-muted">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function SeeAllLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="text-sm text-unison-text-muted transition-colors hover:text-unison-text"
      aria-label={label}
    >
      See all →
    </Link>
  )
}
