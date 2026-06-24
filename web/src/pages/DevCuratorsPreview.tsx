import { CuratorRow } from "@/components/CuratorRow"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { SEED_CURATORS } from "@/lib/dev-seed"

export default function DevCuratorsPreview() {
  return (
    <LeaderboardSection title="Leaderboard" subtitle="Fixtures: Discord icon shows for linked curators.">
      <ul className="space-y-2">
        {SEED_CURATORS.map((entry, i) => (
          <CuratorRow key={entry.keyId} entry={entry} isSelf={i === 0} />
        ))}
      </ul>
    </LeaderboardSection>
  )
}
