import { useEffect, useState } from "react"

const closeMs = () =>
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dropdown-close-dur")) || 150

// Keeps a closed menu mounted while its .t-dropdown close transition plays
export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (open || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), closeMs())
    return () => window.clearTimeout(timer)
  }, [open, mounted])
  return { mounted, closing: mounted && !open }
}
