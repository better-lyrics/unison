export function LoadingPlaceholder({ rows = 5 }: { rows?: number }) {
  const keys = Array.from({ length: rows }, (_, i) => `placeholder-${i}`)
  return (
    <ul className="space-y-2">
      {keys.map((key) => (
        <li
          key={key}
          className="h-16 animate-pulse rounded-lg border border-unison-border bg-unison-bg-elevated"
        />
      ))}
    </ul>
  )
}
