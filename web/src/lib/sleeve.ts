export interface SleeveGlow {
  x: number
  y: number
  r: number
  color: string
}

export interface SleevePaint {
  stops: [string, string, string]
  glows: [SleeveGlow, SleeveGlow]
}

export function sleeveHue(song: string, artist: string): number {
  let h = 2166136261
  for (const ch of `${song}\u0000${artist}`) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619)
  return Math.abs(h) % 360
}

export function sleevePaint(hue: number): SleevePaint {
  const at = (shift: number) => (hue + shift) % 360
  return {
    stops: [`hsl(${hue} 36% 56%)`, `hsl(${at(48)} 30% 33%)`, `hsl(${at(96)} 22% 17%)`],
    glows: [
      { x: 0.74, y: 0.22, r: 0.56, color: `hsla(${at(20)}, 90%, 82%, 0.38)` },
      { x: 0.2, y: 0.88, r: 0.53, color: `hsla(${at(200)}, 70%, 60%, 0.22)` },
    ],
  }
}

export function sleeveCss(song: string, artist: string): string {
  const { stops, glows } = sleevePaint(sleeveHue(song, artist))
  const glow = glows.map(
    (g) => `radial-gradient(${g.r * 100}% ${g.r * 100}% at ${g.x * 100}% ${g.y * 100}%, ${g.color}, transparent)`,
  )
  return `${glow.join(", ")}, linear-gradient(140deg, ${stops[0]}, ${stops[1]} 60%, ${stops[2]})`
}
