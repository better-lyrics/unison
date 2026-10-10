import { youTubeMusicUrl } from "@/lib/youtube-music"
import { useCouncilShortcuts } from "./useCouncilShortcuts"

export function useOpenInYouTubeMusic(videoId: string): void {
  useCouncilShortcuts({
    o: () => {
      window.open(youTubeMusicUrl(videoId), "_blank", "noreferrer")
    },
  })
}
