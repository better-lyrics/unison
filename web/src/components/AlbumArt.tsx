import { IconMusic } from "@tabler/icons-react"
import { useArtwork } from "@/lib/artwork"
import { cn } from "@/lib/cn"

export function AlbumArt({ videoId, className }: { videoId: string; className?: string }) {
  const { data: url } = useArtwork(videoId)
  if (url) {
    return <img src={url} alt="" loading="lazy" className={cn("size-full object-cover", className)} />
  }
  return <IconMusic className="size-6 text-unison-text opacity-50" stroke={1.5} />
}
