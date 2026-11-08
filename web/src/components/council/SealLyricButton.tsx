import { chipClass, chipIconClass, raisedChipClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import { useSealableVariants } from "@/hooks/useCouncilData"
import { useCouncilDecision } from "@/hooks/useCouncilMutations"
import { IconRosetteDiscountCheck } from "@tabler/icons-react"
import { useState } from "react"

export function SealLyricButton({ videoId, lyricsId }: { videoId: string; lyricsId: number }) {
  const item = useSealableVariants(videoId).data?.find((i) => i.id === lyricsId)
  const decision = useCouncilDecision()
  const [confirming, setConfirming] = useState(false)
  if (!item) return null

  if (!confirming) {
    return (
      <button type="button" className={chipClass} onClick={() => setConfirming(true)}>
        <IconRosetteDiscountCheck aria-hidden className={cn(chipIconClass, "text-unison-medal-gold")} stroke={1.75} />
        Seal
      </button>
    )
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-(--ink-3)">Uses one of your seals this month.</span>
      <button type="button" className={chipClass} onClick={() => setConfirming(false)}>
        Cancel
      </button>
      <button
        type="button"
        disabled={decision.isPending}
        className={raisedChipClass}
        onClick={() => {
          setConfirming(false)
          decision.mutate({ kind: "seal", item })
        }}
      >
        Seal lyric
      </button>
    </span>
  )
}
