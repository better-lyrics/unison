interface EmptyStateProps {
  title: string
  hint?: string
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-unison-border bg-unison-bg-elevated px-6 py-10 text-center">
      <p className="text-sm font-medium text-unison-text-secondary">{title}</p>
      {hint ? <p className="mt-1 text-xs text-unison-text-muted">{hint}</p> : null}
    </div>
  )
}
