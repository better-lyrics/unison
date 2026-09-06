import { panelClass } from "@/components/ui"
import { cn } from "@/lib/cn"

interface EmptyStateProps {
  title: string
  hint?: string
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className={cn(panelClass, "px-6 py-10 text-center")}>
      <p className="text-sm font-medium text-unison-text-secondary">{title}</p>
      {hint ? <p className="mt-1 text-xs text-unison-text-muted">{hint}</p> : null}
    </div>
  )
}
