import { isEditableTarget } from "@/lib/dom"
import { type RefObject, useEffect } from "react"

export function useSearchShortcut(ref: RefObject<HTMLInputElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.defaultPrevented) return
      const withMod = e.metaKey || e.ctrlKey
      if (!withMod && isEditableTarget(document.activeElement)) return
      e.preventDefault()
      ref.current?.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [ref, enabled])
}
