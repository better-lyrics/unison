import { useState } from "react"
import { useArtworkCover } from "@/lib/artwork"
import { cn } from "@/lib/cn"
import { sleeveCss } from "@/lib/sleeve"

interface CoverProps {
  song: string
  artist: string
  className?: string
}

export function CoverImage({
  src: primary,
  fallbackSrc,
  song,
  artist,
  className,
}: CoverProps & { src: string | null | undefined; fallbackSrc?: string | null }) {
  const [failed, setFailed] = useState<string[]>([])
  const [loaded, setLoaded] = useState<string | null>(null)
  const src = [primary, fallbackSrc].find((url) => url && !failed.includes(url))
  return (
    <div
      className={cn("relative size-full overflow-hidden", className)}
      style={{ background: sleeveCss(song, artist) }}
    >
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed((urls) => [...urls, src])}
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
  const { data } = useArtworkCover(videoId)
  return <CoverImage src={data?.url} fallbackSrc={data?.fallbackUrl} {...cover} />
}
