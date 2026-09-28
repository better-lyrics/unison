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

export const EASE_OUT = [0.22, 1, 0.36, 1] as const
export const EASE_SETTLE = [0.34, 1.22, 0.64, 1] as const

export const thudFrom = (scale: number, depth = 0.1) => ({
  initial: { scale, opacity: 0 },
  animate: { scale: [scale, 1 - depth, 1 + depth * 0.4, 1], opacity: [0, 1, 1, 1] },
})

export const thudTransition = (delay: number, duration = 0.34): Transition => ({
  duration,
  delay,
  times: [0, 0.55, 0.8, 1],
  ease: ["easeIn", "easeOut", "easeInOut"],
})

export const sealStamp = (delay: number) => ({
  initial: { rotate: -40, scale: 0.4, opacity: 0 },
  animate: { rotate: -6, scale: 1, opacity: 1 },
  transition: { duration: 0.38, delay, ease: EASE_SETTLE } satisfies Transition,
})

const STAGGER_STEP = 0.04
const STAGGER_MAX_STEPS = 12

export const staggerDelay = (index: number) => Math.min(Math.max(index, 0), STAGGER_MAX_STEPS) * STAGGER_STEP
