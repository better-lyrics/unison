import { isEditableTarget } from "@/lib/dom"
import { type RefObject, useEffect, useRef } from "react"

export type ShortcutMap = Record<string, (event: KeyboardEvent) => void>

const CHORD_WINDOW_MS = 1000

const owners: RefObject<ShortcutMap>[] = []
let chordAt = 0

function handlerFor(name: string): ((event: KeyboardEvent) => void) | undefined {
  for (let i = owners.length - 1; i >= 0; i--) {
    const handler = owners[i].current[name]
    if (handler) return handler
  }
  return undefined
}

function run(name: string, event: KeyboardEvent): boolean {
  const handler = handlerFor(name)
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
    if (owners.length === 1) window.addEventListener("keydown", onKeyDown)
    return () => {
      owners.splice(owners.indexOf(mapRef), 1)
      if (owners.length === 0) {
        window.removeEventListener("keydown", onKeyDown)
        chordAt = 0
      }
    }
  }, [enabled])
}
