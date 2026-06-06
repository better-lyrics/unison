interface YouTubeEmbedProps {
  playerRef: (node: HTMLDivElement | null) => void
}

export function YouTubeEmbed({ playerRef }: YouTubeEmbedProps) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg border border-unison-border bg-black">
      <div ref={playerRef} className="size-full" />
    </div>
  )
}
