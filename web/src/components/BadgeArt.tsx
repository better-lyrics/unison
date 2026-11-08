import type { ComponentProps } from "react"
import { transparentBadgeUrl } from "@/lib/badge-view"
import { cn } from "@/lib/cn"

interface BadgeArtProps extends ComponentProps<"span"> {
  src: string | null
  silhouette: string | null
  alt?: string
}

export function BadgeArt({ src, silhouette, alt = "", className, ...rest }: BadgeArtProps) {
  return (
    <span {...rest} className={cn("relative shrink-0", className)}>
      {silhouette ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-[rgba(10,9,13,0.6)]"
          style={{ mask: `url("${silhouette}") center / contain no-repeat` }}
        />
      ) : null}
      {src ? (
        <img src={transparentBadgeUrl(src)} alt={alt} draggable={false} className="relative block size-full object-contain" />
      ) : null}
    </span>
  )
}
