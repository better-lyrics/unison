import { useEffect, useState } from "react"

export interface ScrollEdges {
  up: boolean
  down: boolean
}

const SCROLLER_SELECTOR = "braccato-lyrics, [data-scroller]"

export function useScrollEdges(pane: HTMLElement | null): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ up: false, down: false })

  useEffect(() => {
    if (!pane) return
    let scroller: HTMLElement | null = null
    const update = () => {
      if (!scroller) return
      const up = scroller.scrollTop > 1
      const down = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1
      setEdges((prev) => (prev.up === up && prev.down === down ? prev : { up, down }))
    }
    const resize = new ResizeObserver(update)
    const bind = () => {
      const next = pane.querySelector<HTMLElement>(SCROLLER_SELECTOR)
      if (next === scroller) return
      scroller?.removeEventListener("scroll", update)
      resize.disconnect()
      scroller = next
      if (!scroller) return
      scroller.addEventListener("scroll", update, { passive: true })
      resize.observe(scroller)
      resize.observe(scroller.firstElementChild ?? scroller)
      update()
    }
    const mutations = new MutationObserver(bind)
    mutations.observe(pane, { childList: true, subtree: true })
    bind()
    return () => {
      mutations.disconnect()
      resize.disconnect()
      scroller?.removeEventListener("scroll", update)
    }
  }, [pane])

  return edges
}
