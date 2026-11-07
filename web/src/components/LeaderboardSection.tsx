import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { Tooltip } from "@/components/Tooltip"

interface LeaderboardSectionProps {
  title: ReactNode
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}

const TITLE_CLASS = "text-xl font-semibold tracking-tight text-balance text-unison-text"

export function LeaderboardSection({ title, subtitle, action, children }: LeaderboardSectionProps) {
  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        {subtitle ? (
          <div>
            <Tooltip label={subtitle}>
              <h2 className={TITLE_CLASS}>{title}</h2>
            </Tooltip>
            <p className="sr-only">{subtitle}</p>
          </div>
        ) : (
          <h2 className={TITLE_CLASS}>{title}</h2>
        )}
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
