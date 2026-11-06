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
  const [loaded, setLoaded] = useState<string | null>(null)
  return (
    <div className={cn("relative size-full overflow-hidden", className)} style={{ background: sleeveCss(song, artist) }}>
      {src && src !== failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-[opacity,filter] duration-(--reveal-dur) ease-in-out motion-reduce:transition-none",
            loaded === src ? "opacity-100 blur-none" : "opacity-0 blur-(--reveal-blur)",
          )}
        />
      ) : null}
    </div>
  )
}

export function AlbumArt({ videoId, ...cover }: CoverProps & { videoId: string }) {
  const { data: url } = useArtwork(videoId)
  return <CoverImage src={url} {...cover} />
}
