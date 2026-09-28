import { useMatches } from "react-router-dom"

export type PageWidth = "default" | "wide"

const CLASSES: Record<PageWidth, string> = {
  default: "max-w-5xl px-6",
  wide: "max-w-[1760px] px-6 lg:px-10",
}

export function pageWidthClass(width: PageWidth): string {
  return CLASSES[width]
}

export function usePageWidth(): PageWidth {
  const matches = useMatches()
  return matches.some((m) => (m.handle as { width?: PageWidth } | undefined)?.width === "wide") ? "wide" : "default"
}
