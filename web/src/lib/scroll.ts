import { prefersReducedMotion } from "@/lib/reduced-motion"

export function scrollToStart(element: Element | null) {
  element?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" })
}
