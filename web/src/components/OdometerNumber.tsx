import NumberFlow, { type Format, useCanAnimate } from "@number-flow/react"
import { useEffect, useState } from "react"

interface OdometerNumberProps {
  value: number
  format?: Format
  className?: string
}

// NumberFlow animates on value change, not on first mount, so we start at zero and roll up to
// the real value once mounted. When motion is disabled (reduced-motion or unsupported) we render
// the value straight away with no zero flash.
export function OdometerNumber({ value, format, className }: OdometerNumberProps) {
  const canAnimate = useCanAnimate()
  const [display, setDisplay] = useState(canAnimate ? 0 : value)

  useEffect(() => {
    if (!canAnimate) {
      setDisplay(value)
      return
    }
    const id = requestAnimationFrame(() => setDisplay(value))
    return () => cancelAnimationFrame(id)
  }, [value, canAnimate])

  return <NumberFlow value={display} format={format} className={className} willChange />
}
