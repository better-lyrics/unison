// Playback and seeks stay inside the [start, end] window so a whole song never plays.

export function clampToWindow(seconds: number, start: number, end?: number): number {
  const atLeastStart = Math.max(seconds, start)
  return end !== undefined ? Math.min(atLeastStart, end) : atLeastStart
}

export function reachedWindowEnd(current: number, end?: number): boolean {
  return end !== undefined && current >= end
}

// Resume in place inside the window; restart only when the head is before or past it.
export function shouldRestart(current: number, start: number, end?: number): boolean {
  return current < start || reachedWindowEnd(current, end)
}
