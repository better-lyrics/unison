import { Kbd, KeySteps } from "@/components/Kbd"
import { CouncilOverlay } from "./CouncilOverlay"

type Row = [label: string, keys: string[], steps?: "then" | "or"]

const GROUPS: { title: string; keys: Row[] }[] = [
  {
    title: "Anywhere",
    keys: [
      ["Command menu", ["Mod", "K"]],
      ["Go to overview", ["G", "O"], "then"],
      ["Go to seal queue", ["G", "Q"], "then"],
      ["Go to edits", ["G", "E"], "then"],
      ["Go to activity", ["G", "A"], "then"],
      ["This sheet", ["?"]],
      ["Cancel a decision or close a dialog", ["Escape"]],
    ],
  },
  {
    title: "In a queue",
    keys: [
      ["Next or previous item", ["J", "K"], "or"],
      ["Bookmark or release", ["B"]],
      ["Seal a lyric", ["S"]],
      ["Approve an edit", ["A"]],
      ["Reject with a reason", ["R"]],
      ["Send the rejection", ["Mod", "Enter"]],
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
              {group.keys.map(([label, keys, steps]) => (
                <div
                  key={label}
                  className="flex items-center justify-between py-[5px] text-[13px] text-unison-text-secondary"
                >
                  <dt>{label}</dt>
                  <dd className="flex text-unison-text-muted">
                    {steps ? <KeySteps keys={keys} word={steps} /> : <Kbd keys={keys} />}
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
