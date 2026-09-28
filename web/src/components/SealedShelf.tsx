import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { LeaderboardSection, SeeAllLink } from "@/components/LeaderboardSection"
import { SealedTile, SealedTileSkeleton } from "@/components/SealedTile"
import { skeletonKeys } from "@/components/skeleton"
import { fetchSealed } from "@/lib/api"

const SHELF_LIMIT = 12

const title = (
  <span className="inline-flex items-center gap-2">
    <img src="/badges/committee/image.svg" alt="" className="size-[22px] -rotate-6" />
    Sealed by the Council
  </span>
)

function Shelf({ children }: { children: ReactNode }) {
  return (
    <LeaderboardSection
      title={title}
      subtitle="Lyrics the Better Lyrics Council approved"
      action={<SeeAllLink to="/sealed" label="See all sealed lyrics" />}
    >
      {children}
    </LeaderboardSection>
  )
}

export function SealedShelf() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["sealed", "shelf"],
    queryFn: ({ signal }) => fetchSealed({ sort: "recently-sealed", limit: SHELF_LIMIT, signal }),
    staleTime: 5 * 60_000,
  })

  if (isPending) {
    return (
      <Shelf>
        <div data-testid="sealed-shelf-row" className="flex gap-3.5 overflow-hidden">
          {skeletonKeys("sealed-shelf", 7).map((key) => (
            <SealedTileSkeleton key={key} variant="shelf" />
          ))}
        </div>
      </Shelf>
    )
  }

  if (isError || data.items.length === 0) return null

  return (
    <Shelf>
      <ul
        data-testid="sealed-shelf-row"
        className="flex gap-3.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {data.items.map((entry) => (
          <li key={entry.id} className="shrink-0">
            <SealedTile entry={entry} variant="shelf" />
          </li>
        ))}
      </ul>
    </Shelf>
  )
}
