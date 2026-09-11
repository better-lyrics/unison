import { cn } from "@/lib/cn"
import { type ReactNode, useEffect, useState } from "react"

// The exam needs desktop width; below MIN_WIDTH it is blocked and clears live when wide enough.
const MIN_WIDTH = 1024
const QUERY = `(max-width: ${MIN_WIDTH - 1}px)`

const ROASTS: { gif: string; line: string; big?: boolean }[] = [
  { gif: "https://cdn.betterlyrics.org/speed.gif", line: "DESKTOP. NOW.", big: true },
  {
    gif: "https://cdn.betterlyrics.org/flight.gif",
    line: "get your broke ass off the phone and start this from your desktop",
  },
  {
    gif: "https://cdn.betterlyrics.org/obamna.gif",
    line: "this Council will not review lyrics from a phone. Come back with a real computer, and we'll get to work.",
  },
  {
    gif: "https://cdn.betterlyrics.org/waltuh.gif",
    line: "You clearly don't know who you're talking to. This Council does not read lyrics off a cell phone. Come back with a real computer, or we are done.",
  },
]

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return narrow
}

export function MobileGate({ children }: { children: ReactNode }) {
  const narrow = useNarrowViewport()
  // Pick one roast per load; it stays put if the viewport toggles around the threshold.
  const [roast] = useState(() => ROASTS[Math.floor(Math.random() * ROASTS.length)])
  if (!narrow) return <>{children}</>
  // Full-screen takeover covers the desktop chrome and clips horizontal overflow.
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 overflow-x-hidden overflow-y-auto bg-unison-bg px-6 py-10 text-center">
      <img
        src={roast.gif}
        alt=""
        className="w-full max-w-sm rounded-lg outline outline-1 -outline-offset-1 outline-white/10"
      />
      <p
        className={cn(
          "max-w-md text-balance break-words font-semibold text-unison-text",
          roast.big ? "text-4xl tracking-tight sm:text-5xl" : "text-lg leading-relaxed sm:text-xl",
        )}
      >
        {roast.line}
      </p>
      <p className="max-w-md text-sm text-unison-text-muted">
        This exam needs a desktop or laptop. You know, the same one you've got Better Lyrics installed on? So how
        about you get to it then? Chop chop...
      </p>
    </div>
  )
}
