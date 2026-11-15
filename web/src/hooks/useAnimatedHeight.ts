import { useCallback } from "react"

export function useAnimatedHeight() {
  return useCallback((frame: HTMLElement | null) => {
    const content = frame?.firstElementChild
    if (!frame || !(content instanceof HTMLElement)) return
    let measured = false
    const observer = new ResizeObserver(() => {
      if (measured) {
        frame.style.height = `${content.offsetHeight}px`
        return
      }
      measured = true
      frame.style.transition = "none"
      frame.style.height = `${content.offsetHeight}px`
      void frame.offsetHeight
      frame.style.transition = ""
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
}
