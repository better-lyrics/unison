import { isEditableTarget } from "@/lib/dom"
import { type RefObject, useEffect, useRef } from "react"

// A handler that returns false declines the key, so a lower owner or the page gets it.
export type ShortcutMap = Record<string, (event: KeyboardEvent) => unknown>

const CHORD_WINDOW_MS = 1000
const DIALOG_KEYS = new Set(["mod+k"])

const owners: RefObject<ShortcutMap>[] = []
let chordAt = 0

function run(name: string, event: KeyboardEvent): boolean {
  for (let i = owners.length - 1; i >= 0; i--) {
    const handler = owners[i].current[name]
    if (handler && handler(event) !== false) {
      event.preventDefault()
      return true
    }
  }
  return false
}

function onKeyDown(event: KeyboardEvent) {
  if (event.repeat) return
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const inDialog = document.activeElement?.closest("dialog, [role='dialog']") != null
  if ((event.metaKey || event.ctrlKey) && !event.altKey) {
    const name = `mod+${key}`
    if (!inDialog || DIALOG_KEYS.has(name)) run(name, event)
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.shiftKey && /^[a-z]$/.test(key)) return
  if (inDialog || isEditableTarget(document.activeElement)) return

  if (Date.now() - chordAt <= CHORD_WINDOW_MS) {
    chordAt = 0
    if (run(`g ${key}`, event)) return
  }
  if (key === "g" && owners.some((o) => Object.keys(o.current).some((name) => name.startsWith("g ")))) {
    chordAt = Date.now()
    event.preventDefault()
    return
  }
  run(key, event)
}

export function useCouncilShortcuts(map: ShortcutMap, enabled = true) {
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    if (!enabled) return
    owners.push(mapRef)
    if (owners.length === 1) window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      owners.splice(owners.indexOf(mapRef), 1)
      if (owners.length === 0) {
        window.removeEventListener("keydown", onKeyDown, { capture: true })
        chordAt = 0
      }
    }
  }, [enabled])
}
