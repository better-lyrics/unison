import type { ReactNode } from "react"

interface PageHeadProps {
  title: string
  sub?: ReactNode
  actions?: ReactNode
}

export function PageHead({ title, sub, actions }: PageHeadProps) {
  return (
    <div className="mb-8 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.015em] text-balance">{title}</h1>
        {sub ? (
          <p className="mt-2 text-[13px] text-unison-text-muted [&_b]:font-bold [&_b]:text-unison-text-secondary">
            {sub}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

interface SectionHeadProps {
  id?: string
  title: string
  sub?: ReactNode
  aside?: ReactNode
}

export function SectionHead({ id, title, sub, aside }: SectionHeadProps) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <div>
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {sub ? <p className="mt-0.5 text-xs text-unison-text-muted">{sub}</p> : null}
      </div>
      {aside}
    </div>
  )
}

export const cardClass = "relative rounded-xl bg-white/[0.02] shadow-inset-rim"
