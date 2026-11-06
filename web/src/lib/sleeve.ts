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

const SLEEVE_ANGLE = (140 * Math.PI) / 180

export function sleeveDataUrl(song: string, artist: string, size: number): string | null {
  return sleeveHueDataUrl(sleeveHue(song, artist), size)
}

export function sleeveHueDataUrl(hue: number, size: number): string | null {
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size })
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const { stops, glows } = sleevePaint(hue)
  const [dx, dy] = [Math.sin(SLEEVE_ANGLE), -Math.cos(SLEEVE_ANGLE)]
  const half = (size * (Math.abs(dx) + Math.abs(dy))) / 2
  const mid = size / 2
  const linear = ctx.createLinearGradient(mid - dx * half, mid - dy * half, mid + dx * half, mid + dy * half)
  linear.addColorStop(0, stops[0])
  linear.addColorStop(0.6, stops[1])
  linear.addColorStop(1, stops[2])
  ctx.fillStyle = linear
  ctx.fillRect(0, 0, size, size)
  for (const glow of glows) {
    const radial = ctx.createRadialGradient(
      glow.x * size,
      glow.y * size,
      0,
      glow.x * size,
      glow.y * size,
      glow.r * size,
    )
    radial.addColorStop(0, glow.color)
    radial.addColorStop(1, glow.color.replace(/[\d.]+\)$/, "0)"))
    ctx.fillStyle = radial
    ctx.fillRect(0, 0, size, size)
  }
  return canvas.toDataURL("image/png")
}
