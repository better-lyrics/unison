export function scrollToStart(element: Element | null) {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches
  element?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" })
}
