import { useEffect, useState } from "react"
import { tokenMs } from "@/lib/motion-tokens"

export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (open || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), tokenMs("--dropdown-close-dur", 150))
    return () => window.clearTimeout(timer)
  }, [open, mounted])
  return { mounted, closing: mounted && !open }
}
