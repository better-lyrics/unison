import { Link } from "react-router-dom"
import type { Mark, VariantFull } from "@/lib/types"

interface VariantMetadataProps {
  variant: VariantFull
}

function MarkCallout({ mark }: { mark: Mark }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-unison-medal-gold/10 px-3 py-2">
      <img src={mark.icon} alt="" draggable={false} className="size-7 shrink-0 select-none object-contain" />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold leading-tight text-unison-medal-gold">{mark.label}</div>
        {mark.by ? (
          <div className="mt-0.5 text-[11px] text-unison-text-muted">
            by{" "}
            <Link
              to={`/curator/${mark.by.keyId}`}
              className="text-unison-text-secondary underline-offset-2 hover:underline"
            >
              {mark.by.displayName}
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface RowProps {
  label: string
  children: React.ReactNode
}

function Row({ label, children }: RowProps) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="w-24 shrink-0 text-[11px] uppercase tracking-wider text-unison-text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-unison-text">{children}</dd>
    </div>
  )
}

function truncateKey(keyId: string): string {
  if (keyId.length <= 12) return keyId
  return `${keyId.slice(0, 8)}…${keyId.slice(-4)}`
}

export function VariantMetadata({ variant }: VariantMetadataProps) {
  return (
    <aside className="rounded-lg bg-white/[0.02] p-4">
      {variant.hidden ? (
        <div className="mb-3 rounded border border-unison-warn/40 bg-unison-warn/10 px-3 py-2 text-xs text-unison-warn">
          This variant has been auto-hidden by community downvotes.
        </div>
      ) : null}
      {variant.marks && variant.marks.length > 0 ? (
        <div className="mb-3 space-y-2">
          {variant.marks.map((mark) => (
            <MarkCallout key={`${mark.type}:${mark.at ?? mark.label}`} mark={mark} />
          ))}
        </div>
      ) : null}
      <dl className="divide-y divide-unison-border">
        <Row label="Song">{variant.song}</Row>
        <Row label="Artist">{variant.artist}</Row>
        {variant.album ? <Row label="Album">{variant.album}</Row> : null}
        {variant.isrc ? <Row label="ISRC">{variant.isrc}</Row> : null}
        {variant.language ? <Row label="Language">{variant.language}</Row> : null}
        <Row label="Format">{variant.format.toUpperCase()}</Row>
        <Row label="Sync">{variant.syncType}</Row>
        <Row label="Score">
          <span className="font-mono tabular-nums">{variant.effectiveScore.toFixed(1)}</span>
          <span className="ml-1 font-mono text-xs tabular-nums text-unison-text-muted">{`(${variant.score})`}</span>
        </Row>
        <Row label="Votes">
          <span className="font-mono tabular-nums">{variant.voteCount}</span>
        </Row>
        <Row label="Confidence">{variant.confidence}</Row>
        {variant.submitter ? (
          <Row label="Submitter">
            <Link
              to={`/curator/${variant.submitter.keyId}`}
              className="font-mono text-xs text-unison-text underline-offset-2 hover:underline"
            >
              {truncateKey(variant.submitter.keyId)}
            </Link>
            <span className="ml-2 text-xs text-unison-text-muted">{`rep ${variant.submitter.reputation.toFixed(1)}`}</span>
          </Row>
        ) : null}
      </dl>
    </aside>
  )
}
