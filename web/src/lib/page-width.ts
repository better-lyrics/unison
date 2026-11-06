import { useMatches } from "react-router-dom"

export type PageWidth = "default" | "wide" | "stage"

const CLASSES: Record<PageWidth, string> = {
  default: "max-w-5xl px-6",
  wide: "max-w-[1760px] px-6 lg:px-10",
  stage: "max-w-[1264px] px-5 min-[1001px]:px-8",
}

export function pageWidthClass(width: PageWidth): string {
  return CLASSES[width]
}

export function usePageWidth(): PageWidth {
  const matches = useMatches()
  const widths = matches.flatMap((m) => (m.handle as { width?: PageWidth } | undefined)?.width ?? [])
  return widths.at(-1) ?? "default"
}
