import { MigrateView, type MigrateViewModel } from "@/components/MigrateView"
import { useState } from "react"

const noop = () => {}

const states: { label: string; model: MigrateViewModel }[] = [
  { label: "loading", model: { kind: "loading" } },
  { label: "install", model: { kind: "install" } },
  { label: "prove", model: { kind: "prove", connecting: false, error: null, onConnect: noop } },
  { label: "prove (connecting)", model: { kind: "prove", connecting: true, error: null, onConnect: noop } },
  {
    label: "prove (error)",
    model: {
      kind: "prove",
      connecting: false,
      error: "We could not start the proof. Make sure Better Lyrics is installed, then try again.",
      onConnect: noop,
    },
  },
  { label: "ready", model: { kind: "ready", name: "gwuhbruh" } },
  { label: "ready (no name)", model: { kind: "ready", name: null } },
  { label: "same_key", model: { kind: "same_key" } },
  { label: "expired", model: { kind: "expired" } },
  { label: "error", model: { kind: "error" } },
  { label: "start", model: { kind: "start" } },
]

const tabClass = (active: boolean) =>
  `cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
    active
      ? "border-unison-border-strong bg-unison-bg-hover text-unison-text"
      : "border-unison-border bg-unison-bg-elevated text-unison-text-muted hover:text-unison-text"
  }`

export default function DevMigratePreview() {
  const [idx, setIdx] = useState(5)

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-unison-text">MigratePage states</h2>
      <div className="flex flex-wrap gap-2">
        {states.map((s, i) => (
          <button key={s.label} type="button" className={tabClass(i === idx)} onClick={() => setIdx(i)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-unison-border bg-unison-bg">
        <MigrateView model={states[idx].model} />
      </div>
    </div>
  )
}
