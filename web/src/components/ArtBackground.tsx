import { Kawarp } from "@kawarp/core"
import { useEffect, useRef } from "react"

const WARP = { warpIntensity: 0.9, blurPasses: 8, saturation: 1.4, animationSpeed: 0.8 }
const STILL_FRAME_TIME = 4

interface ArtBackgroundProps {
  src: string | null | undefined
  contained?: boolean
}

export function ArtBackground({ src, contained = false }: ArtBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const warpRef = useRef<Kawarp | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let warp: Kawarp
    try {
      warp = new Kawarp(canvas, WARP)
    } catch (error: unknown) {
      console.warn("Could not start the background art", error)
      return
    }
    warpRef.current = warp
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    const observer = new ResizeObserver(() => {
      const box = contained ? canvas.getBoundingClientRect() : { width: innerWidth, height: innerHeight }
      canvas.width = Math.max(1, Math.round(box.width * 0.5))
      canvas.height = Math.max(1, Math.round(box.height * 0.5))
      warp.resize()
      if (still) warp.renderFrame(STILL_FRAME_TIME)
    })
    observer.observe(canvas)
    if (!still) warp.start()
    return () => {
      observer.disconnect()
      warp.dispose()
      warpRef.current = null
    }
  }, [contained])

  useEffect(() => {
    const warp = warpRef.current
    if (!src || !warp) return
    warp
      .loadImage(src)
      .then(() => {
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) warp.renderFrame(STILL_FRAME_TIME)
      })
      .catch((error: unknown) => console.warn("Could not load the background art", error))
  }, [src])

  if (contained) return <canvas ref={canvasRef} className="absolute inset-0 block size-full" />

  return (
    <>
      <canvas ref={canvasRef} className="fixed inset-0 -z-30 block h-dvh w-screen" />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-20 bg-[linear-gradient(180deg,rgba(10,9,13,calc(var(--scrim)*0.6)),rgba(10,9,13,var(--scrim))_55%,rgba(10,9,13,calc(var(--scrim)+0.25)))]"
      />
    </>
  )
}
