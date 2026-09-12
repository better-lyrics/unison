import type { Transition, Variants } from "motion/react"

export const SWAP_TRANSITION: Transition = { duration: 0.18, ease: "easeInOut" }

export const LAYOUT_TRANSITION: Transition = { duration: 0.3, ease: [0.22, 1, 0.36, 1] }

export const iconSwapVariants: Variants = {
  initial: { opacity: 0, scale: 0.5, filter: "blur(2px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.5, filter: "blur(2px)" },
}

export const labelSwapVariants: Variants = {
  initial: { opacity: 0, y: 4, filter: "blur(2px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -4, filter: "blur(2px)" },
}
