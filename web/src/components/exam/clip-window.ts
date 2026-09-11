// The exam only plays a bounded slice of a video, [start, end]. Playback and seeks
// stay inside that window so a candidate never has to sit through a whole song, and
// the timing question stays focused on the section being judged.

export function clampToWindow(seconds: number, start: number, end?: number): number {
  const atLeastStart = Math.max(seconds, start)
  return end !== undefined ? Math.min(atLeastStart, end) : atLeastStart
}

export function reachedWindowEnd(current: number, end?: number): boolean {
  return end !== undefined && current >= end
}

// The play button resumes in place when the playhead sits inside the window; it
// restarts from the window start only when the head is before the window or has
// already passed its end.
export function shouldRestart(current: number, start: number, end?: number): boolean {
  return current < start || reachedWindowEnd(current, end)
}
