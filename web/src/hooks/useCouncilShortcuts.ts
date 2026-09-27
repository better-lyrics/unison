import { isEditableTarget } from "@/lib/dom"
import { useEffect, useRef } from "react"

export type ShortcutMap = Record<string, (event: KeyboardEvent) => void>

const CHORD_WINDOW_MS = 1000

export function useCouncilShortcuts(map: ShortcutMap, enabled = true) {
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    if (!enabled) return
    let chordAt = 0

    function run(name: string, event: KeyboardEvent): boolean {
      const handler = mapRef.current[name]
      if (!handler) return false
      event.preventDefault()
      handler(event)
      return true
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        run(`mod+${key}`, event)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(document.activeElement)) return

      if (Date.now() - chordAt <= CHORD_WINDOW_MS) {
        chordAt = 0
        if (run(`g ${key}`, event)) return
      }
      if (key === "g" && Object.keys(mapRef.current).some((name) => name.startsWith("g "))) {
        chordAt = Date.now()
        event.preventDefault()
        return
      }
      run(key, event)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}
