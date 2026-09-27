import { useCallback, useRef, useState } from "react"

interface ClockState {
  start: number
  base: number
  since: number
  playing: boolean
}

export function usePreviewClock(startSec: number) {
  const clock = useRef<ClockState>({ start: startSec, base: startSec, since: 0, playing: false })
  const [playing, setPlaying] = useState(false)

  if (clock.current.start !== startSec) {
    clock.current = { start: startSec, base: startSec, since: 0, playing: false }
    if (playing) setPlaying(false)
  }

  const getCurrentTime = useCallback(() => {
    const c = clock.current
    return c.playing ? c.base + (performance.now() - c.since) / 1000 : c.base
  }, [])
  const getPlaying = useCallback(() => clock.current.playing, [])

  const toggle = useCallback(() => {
    const c = clock.current
    if (c.playing) {
      c.base = getCurrentTime()
      c.playing = false
    } else {
      c.since = performance.now()
      c.playing = true
    }
    setPlaying(c.playing)
  }, [getCurrentTime])

  return { playing, toggle, getCurrentTime, getPlaying }
}
