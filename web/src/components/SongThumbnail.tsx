import { AlbumArt } from "@/components/AlbumArt"
import { cn } from "@/lib/cn"

interface SongThumbnailProps {
  videoId: string
  song: string
  artist: string
  className?: string
}

export function SongThumbnail({ className, ...art }: SongThumbnailProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("flex shrink-0 overflow-hidden rounded-md bg-unison-bg-hover", className)}
    >
      <AlbumArt {...art} />
    </div>
  )
}
