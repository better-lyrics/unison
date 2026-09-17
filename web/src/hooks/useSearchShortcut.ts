import { type RefObject, useEffect } from "react"

function isEditableTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
}

export function useSearchShortcut(ref: RefObject<HTMLInputElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return
      const withMod = e.metaKey || e.ctrlKey
      if (!withMod && isEditableTarget(document.activeElement)) return
      e.preventDefault()
      ref.current?.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [ref, enabled])
}
