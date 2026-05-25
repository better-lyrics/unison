import { thumbs } from "@dicebear/collection"
import { createAvatar } from "@dicebear/core"

const cache = new Map<string, string>()

export function dicebearThumbsDataUri(seed: string): string {
  const cached = cache.get(seed)
  if (cached) return cached
  const svg = createAvatar(thumbs, { seed, radius: 50 }).toString()
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  cache.set(seed, uri)
  return uri
}
