import { Kawarp } from "@kawarp/core"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/cn"

const WARP = { warpIntensity: 0.9, blurPasses: 8, saturation: 1.4, animationSpeed: 0.8 }
const SETTLE_MS = 1500

interface ArtBackgroundProps {
  src: string | null | undefined
  contained?: boolean
  moving?: boolean
  onReady?: () => void
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches

export function ArtBackground({ src, contained = false, moving = false, onReady }: ArtBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const warpRef = useRef<Kawarp | null>(null)
  const movingRef = useRef(moving)
  const settleRef = useRef<number | undefined>(undefined)
  const [shown, setShown] = useState(false)
  const [failed, setFailed] = useState(false)

  const play = useCallback((warp: Kawarp) => {
    window.clearTimeout(settleRef.current)
    warp.animationSpeed = WARP.animationSpeed
    warp.start()
  }, [])

  const pause = useCallback((warp: Kawarp) => {
    window.clearTimeout(settleRef.current)
    warp.animationSpeed = 0
    warp.start()
    settleRef.current = window.setTimeout(() => warp.stop(), Math.max(SETTLE_MS, warp.transitionDuration))
  }, [])

  const update = useCallback(
    (warp: Kawarp) => {
      if (reducedMotion()) warp.renderFrame()
      else if (movingRef.current) play(warp)
      else pause(warp)
    },
    [play, pause],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let warp: Kawarp
    try {
      warp = new Kawarp(canvas, { ...WARP, animationSpeed: movingRef.current ? WARP.animationSpeed : 0 })
    } catch (error: unknown) {
      console.warn("Could not start the background art", error)
      setFailed(true)
      return
    }
    if (reducedMotion()) warp.transitionDuration = 0
    warpRef.current = warp
    const observer = new ResizeObserver(() => {
      const box = contained ? canvas.getBoundingClientRect() : { width: innerWidth, height: innerHeight }
      canvas.width = Math.max(1, Math.round(box.width * 0.5))
      canvas.height = Math.max(1, Math.round(box.height * 0.5))
      warp.resize()
      warp.renderFrame()
    })
    observer.observe(canvas)
    return () => {
      window.clearTimeout(settleRef.current)
      observer.disconnect()
      warp.dispose()
      warpRef.current = null
    }
  }, [contained])

  useEffect(() => {
    movingRef.current = moving
    const warp = warpRef.current
    if (warp) update(warp)
  }, [moving, update])

  useEffect(() => {
    const warp = warpRef.current
    if (!src || !warp) return
    warp
      .loadImage(src)
      .then(() => {
        setShown(true)
        setFailed(false)
        update(warp)
      })
      .catch((error: unknown) => {
        console.warn("Could not load the background art", error)
        setFailed(true)
      })
  }, [src, update])

  const fade = cn("transition-opacity duration-700 ease-out motion-reduce:duration-150", shown ? "opacity-100" : "opacity-0")

  useEffect(() => {
    if (shown || failed) onReady?.()
  }, [shown, failed, onReady])

  if (contained) return <canvas ref={canvasRef} className="absolute inset-0 block size-full" />

  return (
    <>
      <canvas ref={canvasRef} className={cn("fixed inset-0 -z-30 block h-dvh w-screen", fade)} />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-20 bg-[linear-gradient(180deg,rgba(10,9,13,calc(var(--scrim)*0.6)),rgba(10,9,13,var(--scrim))_55%,rgba(10,9,13,calc(var(--scrim)+0.25)))]"
      />
    </>
  )
}
