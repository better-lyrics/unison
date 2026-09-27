import { panelClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import type { ReactNode } from "react"

interface EmptyStateProps {
  title: string
  hint?: string
  icon?: ReactNode
  children?: ReactNode
}

export function EmptyState({ title, hint, icon, children }: EmptyStateProps) {
  if (icon) {
    return (
      <div className="rounded-xl bg-white/[0.02] px-6 py-14 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-unison-medal-gold-wash text-unison-medal-gold">
          {icon}
        </div>
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {hint ? (
          <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] leading-normal text-pretty text-unison-text-muted">
            {hint}
          </p>
        ) : null}
        {children ? <div className="mt-[18px]">{children}</div> : null}
      </div>
    )
  }
  return (
    <div className={cn(panelClass, "px-6 py-10 text-center")}>
      <p className="text-sm font-medium text-unison-text-secondary">{title}</p>
      {hint ? <p className="mt-1 text-xs text-unison-text-muted">{hint}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  )
}
