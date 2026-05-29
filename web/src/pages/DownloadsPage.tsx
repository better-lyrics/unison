import { IconCheck, IconCopy, IconDownload } from "@tabler/icons-react"
import { Fragment, type ReactNode, useState } from "react"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchDumpManifest } from "@/lib/api"
import { formatExact, formatRelativeTime } from "@/lib/format"
import type { DumpManifest } from "@/lib/types"

const FALLBACK_LATEST_URL = "https://unison-dumps.boidu.dev/dumps/latest.dump"
const ATTRIBUTION = "Lyrics from Unison (https://unison.boidu.dev)"
const ENTERPRISE_MAILTO = "mailto:enterprise@boidu.dev?subject=Unison%20commercial%20license%20inquiry"

const RESTORE_SNIPPET = `# 1. Download and verify
curl -O https://unison-dumps.boidu.dev/dumps/latest.dump
curl -O https://unison-dumps.boidu.dev/dumps/latest.dump.sha256
sha256sum -c latest.dump.sha256

# 2. Create a fresh database
createdb unison_mirror

# 3. Restore
pg_restore -d unison_mirror --no-owner --no-privileges latest.dump`

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
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error("clipboard write failed", err)
    }
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

function highlightBashLine(line: string, lineIdx: number): ReactNode[] {
  if (line.trimStart().startsWith("#")) {
    return [
      <span key={`${lineIdx}-c`} className="text-unison-text-muted">
        {line}
      </span>,
    ]
  }
  if (line.length === 0) return [""]
  const tokens = line.split(/(\s+)/)
  let seenCommand = false
  return tokens.map((tok, idx) => {
    const key = `${lineIdx}-${idx}`
    if (tok.length === 0 || /^\s+$/.test(tok)) return <Fragment key={key}>{tok}</Fragment>
    let cls: string | undefined
    if (!seenCommand) {
      cls = "text-unison-text"
      seenCommand = true
    } else if (/^--?\w/.test(tok)) {
      cls = "text-purple-400/80"
    } else if (tok.startsWith('"') || tok.startsWith("'")) {
      cls = "text-green-400/80"
    }
    return cls ? (
      <span key={key} className={cls}>
        {tok}
      </span>
    ) : (
      <Fragment key={key}>{tok}</Fragment>
    )
  })
}

function HighlightedBash({ code }: { code: string }) {
  const lines = code.split("\n")
  return (
    <>
      {lines.map((line, lineIdx) => (
        <Fragment key={`line-${lineIdx}-${line.slice(0, 8)}`}>
          {lineIdx > 0 ? "\n" : null}
          {highlightBashLine(line, lineIdx)}
        </Fragment>
      ))}
    </>
  )
}

function HeroSection({ manifest }: { manifest: DumpManifest }) {
  const { lyrics, requested_songs, lyrics_requests } = manifest.row_counts
  return (
    <section className="space-y-4">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">Download the Unison database</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          A daily snapshot of the lyrics corpus and the request queue. No user IDs, votes, or
          reports. Each day's snapshot lands at the same <code>latest.dump</code> URL, so a cron
          pointed at it stays current with no extra plumbing.
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
          A daily snapshot of the lyrics corpus and the request queue. No user IDs, votes, or
          reports.
        </p>
      </div>
      <div className="space-y-2 rounded-2xl border border-unison-border/50 bg-unison-bg-elevated/50 px-4 py-3 text-sm leading-relaxed text-unison-text-secondary">
        <p>Couldn't load the dump manifest ({message}). The latest snapshot is still at:</p>
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
        Verify the checksum, then restore into a fresh Postgres 18 database.
      </p>
      <div className="relative">
        <pre className="overflow-x-auto rounded-2xl border border-unison-border/50 bg-unison-bg-elevated/50 px-4 py-3 pr-12 font-mono text-xs leading-relaxed text-unison-text-secondary">
          <HighlightedBash code={RESTORE_SNIPPET} />
        </pre>
        <div className="absolute right-2 top-2">
          <CopyButton value={RESTORE_SNIPPET} label="Copy restore commands" />
        </div>
      </div>
    </section>
  )
}

function LicenseSection() {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-unison-text">License</h2>
      <p className="text-sm leading-relaxed text-unison-text-secondary">
        The dump is dual-licensed. ODbL 1.0 covers FOSS use; credit Unison and you're done. For
        anything commercial (streaming platforms, labels, distributors), reach out for a
        commercial license.
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
