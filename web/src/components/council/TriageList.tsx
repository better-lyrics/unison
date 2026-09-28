import { EmptyState } from "@/components/EmptyState"
import { Kbd } from "@/components/Kbd"
import { Bone, skeletonKeys } from "@/components/skeleton"
import type { Bookmarkable, Triage } from "@/hooks/useTriage"
import { cn } from "@/lib/cn"
import { plural } from "@/lib/format"
import { IconArrowUp, IconBookmark, IconChevronDown } from "@tabler/icons-react"
import { IconPointer } from "@tabler/icons-react"
import type { ReactNode } from "react"
import { Switch } from "./Switch"

interface TriageListProps<T extends Bookmarkable> {
  label: string
  triage: Triage<T>
  row: (item: T) => ReactNode
  noun: [string, string]
  tools?: ReactNode
  openAside?: string
  empty: ReactNode | null
  noMatch?: string
  flat?: boolean
}

const HEAD =
  "flex w-full items-center gap-2 px-1 pt-5 pb-2.5 text-left text-[11px] uppercase tracking-[0.08em] text-unison-text-muted"
const ROWS = "flex flex-col gap-1.5"
const COUNT = "font-mono tracking-normal"
const ASIDE = "ml-auto text-[11px] normal-case tracking-normal"

export function TriageList<T extends Bookmarkable>({
  label,
  triage,
  row,
  noun,
  tools,
  openAside,
  empty,
  noMatch = "No open items match this filter.",
  flat = false,
}: TriageListProps<T>) {
  const mine = triage.mine.map(row)
  const open = triage.open.map(row)
  const others = triage.others.map(row)
  const { cap, othersOpen } = triage
  const onToggleOthers = () => triage.setOthersOpen(!othersOpen)
  const fresh = { count: triage.fresh.length, onShow: triage.revealFresh }
  return (
    <div className="flex min-h-0 flex-col triage:sticky triage:top-[calc(var(--app-header-h)+2rem)] triage:max-h-[calc(100dvh-var(--app-header-h)-4rem)]">
      {tools ? <div className="flex flex-col gap-2.5 pb-4">{tools}</div> : null}
      <div className="-mx-1.5 min-h-0 overflow-y-auto px-1.5 pb-7 [mask-image:linear-gradient(to_bottom,#000_calc(100%-28px),transparent_100%)] [scrollbar-color:var(--color-unison-border-strong)_transparent] [scrollbar-width:thin]">
        {fresh.count > 0 ? (
          <button
            type="button"
            onClick={fresh.onShow}
            className="sticky top-0 z-[2] mx-auto mt-1 mb-2 flex w-max cursor-pointer items-center gap-1.5 rounded-full bg-unison-text px-3 py-[5px] text-xs font-semibold text-unison-bg shadow-[0_8px_20px_rgba(0,0,0,0.45)] transition-[opacity,scale] active:scale-[0.96]"
          >
            <IconArrowUp aria-hidden className="size-3" stroke={2} />
            {plural(fresh.count, `new ${noun[0]}`, `new ${noun[1]}`)}
          </button>
        ) : null}
        {empty ??
          (flat ? (
            <ul aria-label={label} className={cn(ROWS, "pt-1")}>
              {[...mine, ...open, ...others]}
            </ul>
          ) : (
            <>
              {mine.length > 0 ? (
                <>
                  <div className={HEAD}>
                    <IconBookmark aria-hidden className="size-3" stroke={1.5} />
                    Your bookmarks
                    <span className={COUNT}>{cap === null ? mine.length : `${mine.length}/${cap}`}</span>
                  </div>
                  <ul aria-label="Your bookmarks" className={ROWS}>
                    {mine}
                  </ul>
                </>
              ) : null}
              <div className={HEAD}>
                Open <span className={COUNT}>{open.length}</span>
                {openAside ? <span className={ASIDE}>{openAside}</span> : null}
              </div>
              <ul aria-label={label} className={ROWS}>
                {open.length > 0 ? open : <li className="px-1 py-2 text-xs text-unison-text-muted">{noMatch}</li>}
              </ul>
              {others.length > 0 ? (
                <>
                  <button
                    type="button"
                    aria-expanded={othersOpen}
                    onClick={onToggleOthers}
                    className={cn(HEAD, "cursor-pointer")}
                  >
                    <IconChevronDown
                      aria-hidden
                      className={cn("size-3 transition-transform duration-300", !othersOpen && "-rotate-90")}
                      stroke={1.5}
                    />
                    Bookmarked by others <span className={COUNT}>{others.length}</span>
                    <span className={ASIDE}>Skip these unless they expire</span>
                  </button>
                  {othersOpen ? (
                    <ul aria-label="Bookmarked by others" className={ROWS}>
                      {others}
                    </ul>
                  ) : null}
                </>
              ) : null}
            </>
          ))}
      </div>
      <div className="flex items-center justify-between gap-2 pt-2 text-xs text-unison-text-muted">
        <Switch checked={triage.autoAdvance} onChange={triage.setAutoAdvance}>
          Open the next item after a decision
        </Switch>
        <span className="flex gap-1">
          <Kbd keys={["J"]} />
          <Kbd keys={["K"]} />
        </span>
      </div>
    </div>
  )
}

export function TriageShell({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="grid items-start gap-10 triage:grid-cols-[minmax(360px,460px)_minmax(0,1fr)]">
      {list}
      <div className="min-w-0">{detail}</div>
    </div>
  )
}

export function TriageListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      <Bone className="mb-4 h-8 w-full" />
      {skeletonKeys("row", 6).map((key) => (
        <Bone key={key} className="h-[70px] w-full rounded-[10px]" />
      ))}
    </div>
  )
}

export function NothingSelected() {
  return (
    <EmptyState
      icon={<IconPointer className="size-5" stroke={1.5} />}
      title="Nothing selected"
      hint="Pick an item from the list, or press J to start at the top."
    />
  )
}
