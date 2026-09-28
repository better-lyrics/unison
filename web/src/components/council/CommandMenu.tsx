import { Kbd, KeySteps } from "@/components/Kbd"
import { SongThumbnail } from "@/components/SongThumbnail"
import { useCouncilEdits, useCouncilMembers, useCouncilQueue } from "@/hooks/useCouncilData"
import { cn } from "@/lib/cn"
import { IconArrowRight, IconHistory, IconSearch } from "@tabler/icons-react"
import { type ReactNode, useId, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CouncilOverlay } from "./CouncilOverlay"
import { COUNCIL_SECTIONS } from "./CouncilRail"

interface Command {
  id: string
  group: string
  label: string
  icon: ReactNode
  end?: ReactNode
  to: string
}

const MAX_RESULTS = 12
const SECTION_KEYS: Record<string, string[]> = {
  overview: ["G", "O"],
  queue: ["G", "Q"],
  edits: ["G", "E"],
  activity: ["G", "A"],
}

function useCommands(): Command[] {
  const queue = useCouncilQueue().data ?? []
  const edits = useCouncilEdits().data?.items ?? []
  const members = useCouncilMembers().data ?? []
  const iconClass = "size-4 opacity-70"
  return [
    ...COUNCIL_SECTIONS.map((s) => ({
      id: `go-${s.id}`,
      group: "Go to",
      label: s.label,
      icon: <s.icon aria-hidden className={iconClass} stroke={1.5} />,
      end: SECTION_KEYS[s.id] ? <KeySteps keys={SECTION_KEYS[s.id]} word="then" /> : undefined,
      to: s.to,
    })),
    ...queue.map((i) => ({
      id: `seal-${i.id}`,
      group: "Items",
      label: `${i.song} · ${i.artist}`,
      icon: <SongThumbnail videoId={i.videoId} className="size-6 rounded" />,
      end: <span className="text-xs text-unison-text-muted">Seal queue</span>,
      to: `/council/queue?item=${i.id}`,
    })),
    ...edits.map((e) => ({
      id: `edit-${e.revisionId}`,
      group: "Items",
      label: `${e.song} · ${e.artist}`,
      icon: <SongThumbnail videoId={e.videoId} className="size-6 rounded" />,
      end: <span className="text-xs text-unison-text-muted">Edit</span>,
      to: `/council/edits?item=${e.revisionId}`,
    })),
    ...members.map((m) => ({
      id: `member-${m.keyId}`,
      group: "Members",
      label: `${m.displayName}'s activity`,
      icon: <IconHistory aria-hidden className={iconClass} stroke={1.5} />,
      to: `/council/activity?actor=${encodeURIComponent(m.keyId)}`,
    })),
  ]
}

function filterCommands(commands: Command[], query: string): Command[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === "") return commands.filter((c) => c.group === "Go to")
  return commands.filter((c) => c.label.toLocaleLowerCase().includes(needle)).slice(0, MAX_RESULTS)
}

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <CouncilOverlay
      open={open}
      onOpenChange={onOpenChange}
      label="Command menu"
      initialFocus={inputRef}
      className="top-[14vh]"
    >
      <MenuBody inputRef={inputRef} onClose={() => onOpenChange(false)} />
    </CouncilOverlay>
  )
}

function MenuBody({ inputRef, onClose }: { inputRef: React.RefObject<HTMLInputElement | null>; onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const listId = useId()
  const results = filterCommands(useCommands(), query)
  const current = Math.min(active, Math.max(0, results.length - 1))
  const run = (command: Command) => {
    onClose()
    navigate(command.to)
  }

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-unison-border px-4 py-3.5">
        <IconSearch aria-hidden className="size-4 opacity-50" stroke={1.5} />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[current] ? `${listId}-${results[current].id}` : undefined}
          aria-label="Type a command or a song title"
          placeholder="Type a command or a song title"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              const step = e.key === "ArrowDown" ? 1 : -1
              setActive((current + step + results.length) % Math.max(1, results.length))
            } else if (e.key === "Enter" && results[current]) {
              e.preventDefault()
              run(results[current])
            }
          }}
          className="flex-1 border-0 bg-transparent text-[15px] outline-none placeholder:text-unison-text-muted"
        />
        <Kbd keys={["Escape"]} className="text-unison-text-muted" />
      </div>
      <div
        id={listId}
        // biome-ignore lint/a11y/useSemanticElements: combobox popup; a native select cannot show thumbnails or key hints
        role="listbox"
        tabIndex={-1}
        aria-label="Commands"
        className="max-h-[360px] overflow-y-auto p-1.5"
      >
        {results.length === 0 ? (
          <p className="p-4 text-[13px] text-unison-text-muted">No matches.</p>
        ) : (
          groupsOf(results).map((group) => (
            <div
              key={group.name}
              // biome-ignore lint/a11y/useSemanticElements: a group of listbox options, not form controls
              role="group"
              aria-label={group.name}
            >
              <div aria-hidden className="px-2.5 pt-2.5 pb-1 text-[11px] text-unison-text-muted">
                {group.name}
              </div>
              {group.items.map(({ command, index: i }) => (
                <div
                  key={command.id}
                  id={`${listId}-${command.id}`}
                  // biome-ignore lint/a11y/useSemanticElements: option of the combobox popup above
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === current}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(command)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") run(command)
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-unison-text-secondary",
                    i === current && "bg-unison-bg-hover text-unison-text shadow-inset-rim",
                  )}
                >
                  {command.icon}
                  <span className="truncate">{command.label}</span>
                  {command.end ? <span className="ml-auto flex shrink-0 gap-0.5">{command.end}</span> : null}
                  {i === current && !command.end ? (
                    <IconArrowRight aria-hidden className="ml-auto size-3.5 opacity-60" stroke={1.5} />
                  ) : null}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  )
}

function groupsOf(results: Command[]): { name: string; items: { command: Command; index: number }[] }[] {
  const groups: { name: string; items: { command: Command; index: number }[] }[] = []
  results.forEach((command, index) => {
    const last = groups.at(-1)
    if (last?.name === command.group) last.items.push({ command, index })
    else groups.push({ name: command.group, items: [{ command, index }] })
  })
  return groups
}
