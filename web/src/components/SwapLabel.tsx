import { AnimatePresence, motion } from "motion/react"
import { labelSwapVariants, SWAP_TRANSITION } from "@/lib/motion-variants"

export function SwapLabel({ text }: { text: string }) {
  return (
    <motion.span layout className="relative inline-grid">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={text}
          layout
          variants={labelSwapVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={SWAP_TRANSITION}
          className="inline-block"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  )
}
