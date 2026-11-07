import { Kawarp } from "@kawarp/core"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/cn"
import { tokenMs } from "@/lib/motion-tokens"
import { isPhone } from "@/lib/phone"

const WARP = { warpIntensity: 0.9, blurPasses: 8, saturation: 1.5, animationSpeed: 0.8 }
const SETTLE_MS = 1500
const PAGE_SCALE = 0.5

interface ArtBackgroundProps {
  src: string | null | undefined
  contained?: boolean
  moving?: boolean
  dithering?: number
  onReady?: () => void
  onShow?: (src: string) => void
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches
const animates = (moving: boolean) => moving && !isPhone()

export function ArtBackground({ src, contained = false, moving = false, dithering, onReady, onShow }: ArtBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const warpRef = useRef<Kawarp | null>(null)
  const movingRef = useRef(animates(moving))
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
      warp = new Kawarp(canvas, {
        ...WARP,
        transitionDuration: tokenMs("--art-fade", 1000),
        animationSpeed: movingRef.current ? WARP.animationSpeed : 0,
      })
    } catch (error: unknown) {
      console.warn("Could not start the background art", error)
      setFailed(true)
      return
    }
    if (reducedMotion()) warp.transitionDuration = 0
    warpRef.current = warp
    const observer = new ResizeObserver(() => {
      const box = contained ? canvas.getBoundingClientRect() : { width: innerWidth, height: innerHeight }
      const scale = contained ? devicePixelRatio : PAGE_SCALE
      canvas.width = Math.max(1, Math.round(box.width * scale))
      canvas.height = Math.max(1, Math.round(box.height * scale))
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
    movingRef.current = animates(moving)
    const warp = warpRef.current
    if (warp) update(warp)
  }, [moving, update])

  useEffect(() => {
    if (warpRef.current && dithering !== undefined) warpRef.current.dithering = dithering
  }, [dithering])

  const targetRef = useRef(src)
  const loadedRef = useRef<Kawarp | null>(null)
  const onShowRef = useRef(onShow)
  onShowRef.current = onShow
  const drainingRef = useRef<Kawarp | null>(null)

  const drain = useCallback(
    async (warp: Kawarp) => {
      if (drainingRef.current === warp) return
      drainingRef.current = warp
      let applied: string | null | undefined
      while (warpRef.current === warp && targetRef.current && targetRef.current !== applied) {
        applied = targetRef.current
        try {
          await warp.loadImage(applied)
          if (warpRef.current !== warp) break
          const crossfaded = loadedRef.current === warp
          loadedRef.current = warp
          onShowRef.current?.(applied)
          setShown(true)
          setFailed(false)
          update(warp)
          if (crossfaded) await new Promise((resolve) => window.setTimeout(resolve, warp.transitionDuration))
        } catch (error: unknown) {
          console.warn("Could not load the background art", error)
          setFailed(true)
        }
      }
      if (drainingRef.current === warp) drainingRef.current = null
    },
    [update],
  )

  useEffect(() => {
    targetRef.current = src
    const warp = warpRef.current
    if (warp) void drain(warp)
  }, [src, drain])

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
