import { IconCheck, IconCopy, IconDownload } from "@tabler/icons-react"
import { useState } from "react"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchDumpManifest } from "@/lib/api"
import { formatExact, formatRelativeTime } from "@/lib/format"
import type { DumpManifest } from "@/lib/types"

const FALLBACK_LATEST_URL = "https://dumps.unison.boidu.dev/latest.dump"
const ATTRIBUTION = "Lyrics from Unison (https://unison.boidu.dev)"
const ENTERPRISE_MAILTO = "mailto:enterprise@boidu.dev?subject=Unison%20commercial%20license%20inquiry"

const RESTORE_SNIPPET = `# 1. Download and verify
curl -O https://dumps.unison.boidu.dev/latest.dump
curl -O https://dumps.unison.boidu.dev/latest.dump.sha256
sha256sum -c latest.dump.sha256

# 2. Create a fresh database
createdb unison_mirror

# 3. Restore
pg_restore -d unison_mirror --no-owner --no-privileges latest.dump

# 4. Rebuild the full-text search index (omitted for size)
psql unison_mirror -c "UPDATE public_dump.lyrics SET lyrics_text_search = to_tsvector('simple', lyrics);"
psql unison_mirror -c "CREATE INDEX idx_lyrics_text_search ON public_dump.lyrics USING GIN (lyrics_text_search);"`

function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000
  if (mb < 1000) return `${mb.toFixed(1)} MB`
  const gb = mb / 1000
  return `${gb.toFixed(2)} GB`
}

function generatedRelative(iso: string): string {
  const epochSec = Math.floor(new Date(iso).getTime() / 1000)
  if (!Number.isFinite(epochSec)) return iso
  return formatRelativeTime(epochSec)
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? "Copied" : label}
      className="cursor-pointer shrink-0 rounded-md p-1 text-unison-text-muted transition-colors hover:bg-unison-bg-hover hover:text-unison-text"
    >
      {copied ? <IconCheck className="size-4" stroke={1.5} /> : <IconCopy className="size-4" stroke={1.5} />}
    </button>
  )
}

function HeroSection({ manifest }: { manifest: DumpManifest }) {
  const { lyrics, requested_songs, lyrics_requests } = manifest.row_counts
  return (
    <section className="space-y-4">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">Download the Unison database</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          A daily snapshot of everything public: every accepted lyric variant, every requested song, and how often each
          one's been asked for. There are no user identifiers, no votes, and no reports in the dump, just the lyrics and
          the demand. The URL is stable: each day's snapshot replaces the previous one at <code>latest.dump</code>, so
          you can point a cron job at it and forget about it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={manifest.latest_url}
          className="inline-flex items-center gap-2 rounded-md bg-unison-bg-elevated px-3 py-1.5 text-sm font-medium text-unison-text transition-colors hover:bg-unison-bg-hover"
        >
          <IconDownload className="size-4" stroke={1.5} />
          Download latest dump
        </a>
        <span className="text-xs text-unison-text-muted">
          Generated {generatedRelative(manifest.generated_at)}
          <span className="px-1.5 opacity-60">·</span>
          {formatBytes(manifest.bytes)}
          <span className="px-1.5 opacity-60">·</span>
          {formatExact(lyrics)} lyrics, {formatExact(requested_songs)} requested songs, {formatExact(lyrics_requests)}{" "}
          requests
        </span>
      </div>
    </section>
  )
}

function HeroLoading() {
  return (
    <section className="space-y-4">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">Download the Unison database</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">Loading dump manifest...</p>
      </div>
      <div className="h-9 w-48 animate-pulse rounded-md bg-unison-bg-elevated" />
    </section>
  )
}

function HeroError({ message }: { message: string }) {
  return (
    <section className="space-y-4">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">Download the Unison database</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          A daily snapshot of everything public: every accepted lyric variant, every requested song, and how often each
          one's been asked for. There are no user identifiers, no votes, and no reports in the dump, just the lyrics and
          the demand.
        </p>
      </div>
      <div className="space-y-2 rounded-2xl border border-unison-border/50 bg-unison-bg-elevated/50 px-4 py-3 text-sm leading-relaxed text-unison-text-secondary">
        <p>Couldn't load the dump manifest ({message}). You can still grab the latest snapshot directly:</p>
        <p>
          <a href={FALLBACK_LATEST_URL} className="text-unison-text transition-colors hover:text-unison-text-secondary">
            {FALLBACK_LATEST_URL}
          </a>
        </p>
      </div>
    </section>
  )
}

function RestoreSection() {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-unison-text">Restore</h2>
      <p className="text-sm leading-relaxed text-unison-text-secondary">
        Verify the checksum, then restore into a fresh Postgres 16 database. The full-text search index is dropped from
        the dump to keep it small; rebuild it locally after restore.
      </p>
      <pre className="overflow-x-auto rounded-2xl border border-unison-border/50 bg-unison-bg-elevated/50 px-4 py-3 font-mono text-xs leading-relaxed text-unison-text-secondary">
        {RESTORE_SNIPPET}
      </pre>
    </section>
  )
}

function LicenseSection() {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-unison-text">License</h2>
      <p className="text-sm leading-relaxed text-unison-text-secondary">
        The dump is dual-licensed. For open-source use (your own player, research, hobby projects), it's available under
        the Open Database License (ODbL 1.0): credit Unison and you're done. If you're using it commercially (a
        streaming service, distributor, label), reach out for a commercial license.
      </p>
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-unison-text-muted">Required attribution</p>
        <div className="flex items-center gap-2 rounded-2xl border border-unison-border/50 bg-unison-bg-elevated/50 px-4 py-3">
          <code className="min-w-0 flex-1 font-mono text-xs text-unison-text">{ATTRIBUTION}</code>
          <CopyButton value={ATTRIBUTION} label="Copy attribution" />
        </div>
      </div>
      <p className="text-sm leading-relaxed text-unison-text-secondary">
        Commercial inquiries:{" "}
        <a href={ENTERPRISE_MAILTO} className="text-unison-text transition-colors hover:text-unison-text-secondary">
          Email enterprise@boidu.dev
        </a>
      </p>
    </section>
  )
}

function DownloadsFooter() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-unison-border pt-6 text-xs text-unison-text-muted">
      <div>
        <span className="text-unison-text-secondary">Related projects</span>
        <span className="px-1.5 opacity-60">·</span>
        <a
          href="https://betterlyrics.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-unison-text transition-colors hover:text-unison-text-secondary"
        >
          Better Lyrics
        </a>
        <span className="px-1.5 opacity-60">·</span>
        <a
          href="https://composer.boidu.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="text-unison-text transition-colors hover:text-unison-text-secondary"
        >
          Composer
        </a>
      </div>
      <a
        href="https://github.com/better-lyrics/unison"
        target="_blank"
        rel="noopener noreferrer"
        className="text-unison-text transition-colors hover:text-unison-text-secondary"
      >
        GitHub
      </a>
    </footer>
  )
}

export function DownloadsPage() {
  const { status, data, error } = useAsyncData(fetchDumpManifest, "dump:manifest")
  return (
    <div className="max-w-2xl space-y-10">
      {status === "loading" ? <HeroLoading /> : null}
      {status === "error" ? <HeroError message={error.message} /> : null}
      {status === "success" ? <HeroSection manifest={data} /> : null}
      <RestoreSection />
      <LicenseSection />
      <DownloadsFooter />
    </div>
  )
}
