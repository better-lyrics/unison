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
      className={cn("relative flex shrink-0 overflow-hidden rounded-md bg-unison-bg-hover after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:outline after:outline-1 after:-outline-offset-1 after:outline-white/10", className)}
    >
      <AlbumArt {...art} />
    </div>
  )
}
