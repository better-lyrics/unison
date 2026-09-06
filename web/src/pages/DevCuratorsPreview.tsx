import { BadgeCatalogueProvider } from "@/components/BadgeCatalogueContext"
import { CuratorRow } from "@/components/CuratorRow"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { SEED_CURATORS } from "@/lib/dev-seed"

export default function DevCuratorsPreview() {
  return (
    <BadgeCatalogueProvider>
      <LeaderboardSection title="Leaderboard" subtitle="Fixtures: top badge, tier gems for the top 3, Discord cutouts.">
        <ul className="space-y-2">
          {SEED_CURATORS.map((entry, i) => (
            <CuratorRow key={entry.keyId} entry={entry} isSelf={i === 0} />
          ))}
        </ul>
      </LeaderboardSection>
    </BadgeCatalogueProvider>
  )
}
