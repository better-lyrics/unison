import { useState } from "react"
import { useArtwork } from "@/lib/artwork"
import { cn } from "@/lib/cn"
import { sleeveCss } from "@/lib/sleeve"

interface CoverProps {
  song: string
  artist: string
  className?: string
}

export function CoverImage({ src, song, artist, className }: CoverProps & { src: string | null | undefined }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (src && src !== failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(src)}
        className={cn("size-full object-cover", className)}
      />
    )
  }
  return <div className={cn("size-full", className)} style={{ background: sleeveCss(song, artist) }} />
}

export function AlbumArt({ videoId, ...cover }: CoverProps & { videoId: string }) {
  const { data: url } = useArtwork(videoId)
  return <CoverImage src={url} {...cover} />
}
