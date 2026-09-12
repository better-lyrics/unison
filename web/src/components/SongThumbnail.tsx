import { AlbumArt } from "@/components/AlbumArt"
import { cn } from "@/lib/cn"

export function SongThumbnail({ videoId, className }: { videoId: string; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-unison-bg-hover",
        className,
      )}
    >
      <AlbumArt videoId={videoId} />
    </div>
  )
}
