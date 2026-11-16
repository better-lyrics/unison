import { useEffect, useState } from "react"
import { tokenMs } from "@/lib/motion-tokens"

export function usePresence(open: boolean, closeDuration = "--dropdown-close-dur") {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (open || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), tokenMs(closeDuration, 150))
    return () => window.clearTimeout(timer)
  }, [open, mounted, closeDuration])
  return { mounted, closing: mounted && !open }
}
