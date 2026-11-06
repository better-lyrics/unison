import { useMatches } from "react-router-dom"

export const ART_CHROME = { chrome: "art" } as const

function isArtChrome(handle: unknown): boolean {
  return typeof handle === "object" && handle !== null && "chrome" in handle && handle.chrome === "art"
}

export function useArtChrome(): boolean {
  return useMatches().some((match) => isArtChrome(match.handle))
}
