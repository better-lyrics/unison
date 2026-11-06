import { useCallback } from "react"

export function useFillHeight(target: string) {
  return useCallback(
    (container: HTMLElement | null) => {
      if (!container) return
      const measure = () => {
        const pane = container.querySelector<HTMLElement>(target)
        if (!pane) return
        let below = 0
        for (let node = pane.parentElement; node && node !== document.body; node = node.parentElement) {
          const style = getComputedStyle(node)
          below += (Number.parseFloat(style.paddingBottom) || 0) + (Number.parseFloat(style.marginBottom) || 0)
        }
        const top = pane.getBoundingClientRect().top + window.scrollY
        container.style.setProperty("--fill-height", `${Math.max(0, window.innerHeight - top - below)}px`)
      }
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(document.body)
      window.addEventListener("resize", measure)
      return () => {
        observer.disconnect()
        window.removeEventListener("resize", measure)
      }
    },
    [target],
  )
}
