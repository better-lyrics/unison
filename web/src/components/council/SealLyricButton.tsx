import { buttonClass } from "@/components/ui"
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
      <button type="button" className={buttonClass("fill", "sm")} onClick={() => setConfirming(true)}>
        <IconRosetteDiscountCheck aria-hidden className="size-3.5 text-unison-medal-gold" stroke={1.75} />
        Seal
      </button>
    )
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-unison-text-muted">Uses one of your seals this month.</span>
      <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setConfirming(false)}>
        Cancel
      </button>
      <button
        type="button"
        disabled={decision.isPending}
        className={buttonClass("primary", "sm")}
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
