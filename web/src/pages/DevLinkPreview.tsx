import { useState } from "react"
import { DiscordBadge } from "@/components/DiscordBadge"
import { type DiscordSectionModel, DiscordSectionView } from "@/components/DiscordSection"
import { LinkView, type LinkViewModel } from "@/components/LinkView"

const noop = () => {}

const linkStates: { label: string; model: LinkViewModel }[] = [
  { label: "loading", model: { kind: "loading" } },
  { label: "install", model: { kind: "install" } },
  { label: "connect", model: { kind: "connect", connecting: false, error: null, onConnect: noop } },
  { label: "connecting", model: { kind: "connect", connecting: true, error: null, onConnect: noop } },
  {
    label: "connect error",
    model: {
      kind: "connect",
      connecting: false,
      error: "We could not start the link. Make sure Better Lyrics is installed, then try again.",
      onConnect: noop,
    },
  },
  {
    label: "existing",
    model: { kind: "existing", name: "user#1234", working: false, error: null, onDisconnect: noop },
  },
  {
    label: "existing (working)",
    model: { kind: "existing", name: "user#1234", working: true, error: null, onDisconnect: noop },
  },
  { label: "linked", model: { kind: "linked", name: "user#1234" } },
  { label: "blocked", model: { kind: "blocked" } },
  { label: "expired", model: { kind: "expired", onReset: noop } },
  { label: "error", model: { kind: "error", onReset: noop } },
]

const baseSection: Omit<DiscordSectionModel, "status"> = {
  username: "user#1234",
  connecting: false,
  working: false,
  error: null,
  onConnect: noop,
  onDisconnect: noop,
}

const sectionStates: { label: string; model: DiscordSectionModel }[] = [
  { label: "unlinked", model: { ...baseSection, status: "unlinked", username: null } },
  { label: "linked", model: { ...baseSection, status: "linked" } },
  { label: "linked (working)", model: { ...baseSection, status: "linked", working: true } },
  { label: "loading", model: { ...baseSection, status: "loading" } },
]

const tabClass = (active: boolean) =>
  `cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
    active
      ? "border-unison-border-strong bg-unison-bg-hover text-unison-text"
      : "border-unison-border bg-unison-bg-elevated text-unison-text-muted hover:text-unison-text"
  }`

export default function DevLinkPreview() {
  const [linkIdx, setLinkIdx] = useState(1)
  const [sectionIdx, setSectionIdx] = useState(1)

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-unison-text">LinkPage states</h2>
        <div className="flex flex-wrap gap-2">
          {linkStates.map((s, i) => (
            <button key={s.label} type="button" className={tabClass(i === linkIdx)} onClick={() => setLinkIdx(i)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-unison-border bg-unison-bg">
          <LinkView model={linkStates[linkIdx].model} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-unison-text">Me page Discord section</h2>
        <div className="flex flex-wrap gap-2">
          {sectionStates.map((s, i) => (
            <button key={s.label} type="button" className={tabClass(i === sectionIdx)} onClick={() => setSectionIdx(i)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="max-w-md">
          <DiscordSectionView model={sectionStates[sectionIdx].model} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-unison-text">Public profile badge</h2>
        <div className="flex items-center gap-3 rounded-lg border border-unison-border bg-unison-bg-elevated p-4">
          <span className="text-lg font-semibold text-unison-text">Display Name</span>
          <DiscordBadge />
        </div>
      </section>
    </div>
  )
}
