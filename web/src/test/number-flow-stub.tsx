import type { ReactElement } from "react"

// Test-only replacement for @number-flow/react (aliased in vite.config test block). The real
// component relies on matchMedia and Web Animations, which happy-dom lacks; here we render the
// formatted value synchronously so tests can assert on it.
export type Format = Intl.NumberFormatOptions

export function useCanAnimate(): boolean {
  return false
}

export default function NumberFlow({
  value,
  format,
  className,
}: {
  value: number
  format?: Format
  className?: string
}): ReactElement {
  return <span className={className}>{new Intl.NumberFormat("en-US", format).format(value)}</span>
}
