import { Kbd } from "@/components/Kbd"
import { CouncilOverlay } from "./CouncilOverlay"

const GROUPS: { title: string; keys: [string, string[]][] }[] = [
  {
    title: "Anywhere",
    keys: [
      ["Command menu", ["Mod", "K"]],
      ["Go to overview", ["G", "O"]],
      ["Go to seal queue", ["G", "Q"]],
      ["Go to edits", ["G", "E"]],
      ["Go to activity", ["G", "A"]],
      ["This sheet", ["?"]],
    ],
  },
  {
    title: "In a queue",
    keys: [
      ["Next or previous item", ["J", "K"]],
      ["Bookmark or release", ["B"]],
      ["Seal (queue) or approve (edits)", ["S", "A"]],
      ["Reject with a reason", ["R"]],
      ["Play lyric preview", ["P"]],
      ["Open in YouTube Music", ["O"]],
      ["Search this list", ["/"]],
    ],
  },
]

export function ShortcutsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <CouncilOverlay
      open={open}
      onOpenChange={onOpenChange}
      label="Keyboard shortcuts"
      className="top-1/2 w-[min(620px,calc(100vw-32px))] -translate-y-1/2 px-[22px] py-5"
    >
      <h2 className="mb-3.5 text-base font-semibold">Keyboard shortcuts</h2>
      <div className="grid gap-x-7 min-[640px]:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mt-2.5 mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-unison-text-muted">
              {group.title}
            </h3>
            <dl>
              {group.keys.map(([label, keys]) => (
                <div
                  key={label}
                  className="flex items-center justify-between py-[5px] text-[13px] text-unison-text-secondary"
                >
                  <dt>{label}</dt>
                  <dd className="text-unison-text-muted">
                    <Kbd keys={keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </CouncilOverlay>
  )
}
