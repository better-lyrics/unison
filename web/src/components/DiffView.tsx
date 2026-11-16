import { cn } from "@/lib/cn"
import { plural } from "@/lib/format"
import { FIELD_LABEL, fieldValueText } from "@/lib/revision-fields"
import type { DiffPart, DiffRow, HeadTextRef, SyllableChange } from "@/lib/revision-types"
import { IconArrowRight } from "@tabler/icons-react"
import type { ReactNode } from "react"

export type DiffMode = "unified" | "split"

type LineKind = "same" | "add" | "del" | "timing"

interface Line {
  kind: LineKind
  lineNo: number
  prefix: string
  body: ReactNode
  note?: string
}

function stamp(ms: number | null): string {
  if (ms === null) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `[${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(Math.floor((ms % 1000) / 10))}] `
}

function label(head: HeadTextRef | undefined): string {
  if (!head) return ""
  const parts = [head.kind, head.lang, head.line === null ? null : `L${head.line}`].filter(Boolean)
  return `[${parts.join(" ")}] `
}

function marked(parts: DiffPart[], keep: "-" | "+"): ReactNode {
  return parts
    .filter(([op]) => op === "=" || op === keep)
    .map(([op, text], i) => (op === "=" ? text : <mark key={`${i}-${text}`}>{text}</mark>))
}

export function timingNote(deltaMs: number): string {
  return `${(Math.abs(deltaMs) / 1000).toFixed(2)} s ${deltaMs < 0 ? "earlier" : "later"}`
}

function syllableNote(change: SyllableChange): string | undefined {
  if (change.before === null) return "syllable timing added"
  if (change.after === null) return "syllable timing removed"
  if (change.moved > 0) return `${plural(change.moved, "syllable", "syllables")} retimed`
  return undefined
}

type FieldRow = Extract<DiffRow, { kind: "field" }>
type LineRow = Exclude<DiffRow, { kind: "field" }>
type SyllableRow = Extract<DiffRow, { kind: "syllable" }>
type TimingRow = Extract<DiffRow, { kind: "timing" }>

interface Resynced {
  lineNo: number
  startMs: number | null
  beforeMs: number | null
  text: string
  change: SyllableChange
  timing?: string
}

function resyncedSyllables(row: SyllableRow): Resynced {
  return { lineNo: row.lineNo, startMs: row.startMs, beforeMs: row.startMs, text: row.text, change: row }
}

function resyncedTiming(row: TimingRow, change: SyllableChange): Resynced {
  return {
    lineNo: row.lineNo,
    startMs: row.startMs,
    beforeMs: row.startMs - row.deltaMs,
    text: row.text,
    change,
    timing: timingNote(row.deltaMs),
  }
}

function resyncedUnified(row: Resynced): Item[] {
  const after = resyncedLine(row, "after", row.startMs)
  if (after.kind === "timing") return [{ line: after }]
  return [{ line: resyncedLine(row, "before", row.startMs) }, { line: after }]
}

function resyncedSide(row: Resynced, which: "before" | "after"): Item[] {
  return [{ line: resyncedLine(row, which, which === "before" ? row.beforeMs : row.startMs) }]
}

function resyncedLine(row: Resynced, which: "before" | "after", startMs: number | null): Line {
  const before = row.change.before ?? row.text
  const after = row.change.after ?? row.text
  const note = [row.timing, syllableNote(row.change)].filter(Boolean).join(", ")
  return {
    kind: before === after ? "timing" : which === "before" ? "del" : "add",
    lineNo: row.lineNo,
    prefix: stamp(startMs),
    body: which === "before" ? before : after,
    note: which === "after" && note ? note : undefined,
  }
}

type Item = { gap: { count: number } } | { line: Line }

function unified(rows: LineRow[]): Item[] {
  return rows.flatMap((row): Item[] => {
    switch (row.kind) {
      case "gap":
        return [{ gap: row }]
      case "word": {
        const prefix = stamp(row.startMs) + label(row.head)
        return [
          { line: { kind: "del", lineNo: row.lineNo, prefix, body: marked(row.parts, "-") } },
          { line: { kind: "add", lineNo: row.lineNo, prefix, body: marked(row.parts, "+") } },
        ]
      }
      case "timing":
        if (row.syllables) return resyncedUnified(resyncedTiming(row, row.syllables))
        return [
          {
            line: {
              kind: "timing",
              lineNo: row.lineNo,
              prefix: stamp(row.startMs),
              body: row.text,
              note: timingNote(row.deltaMs),
            },
          },
        ]
      case "syllable":
        return resyncedUnified(resyncedSyllables(row))
      default:
        return [
          {
            line: { kind: row.kind, lineNo: row.lineNo, prefix: stamp(row.startMs) + label(row.head), body: row.text },
          },
        ]
    }
  })
}

function side(rows: LineRow[], which: "before" | "after"): Item[] {
  return rows.flatMap((row): Item[] => {
    switch (row.kind) {
      case "gap":
        return [{ gap: row }]
      case "same":
        return [
          { line: { kind: "same", lineNo: row.lineNo, prefix: stamp(row.startMs) + label(row.head), body: row.text } },
        ]
      case "word":
        return [
          {
            line: {
              kind: which === "before" ? "del" : "add",
              lineNo: row.lineNo,
              prefix: stamp(row.startMs) + label(row.head),
              body: marked(row.parts, which === "before" ? "-" : "+"),
            },
          },
        ]
      case "timing":
        if (row.syllables) return resyncedSide(resyncedTiming(row, row.syllables), which)
        return [
          {
            line: {
              kind: "timing",
              lineNo: row.lineNo,
              prefix: stamp(which === "before" ? row.startMs - row.deltaMs : row.startMs),
              body: row.text,
            },
          },
        ]
      case "syllable":
        return resyncedSide(resyncedSyllables(row), which)
      case "del":
      case "add":
        if ((row.kind === "del") !== (which === "before")) return []
        return [
          {
            line: { kind: row.kind, lineNo: row.lineNo, prefix: stamp(row.startMs) + label(row.head), body: row.text },
          },
        ]
    }
  })
}

const SIGN: Record<LineKind, string> = { same: "", add: "+", del: "-", timing: "~" }

const ROW_TONE: Record<LineKind, string> = {
  same: "[&_.code]:text-unison-text-muted",
  add: "bg-[rgba(111,122,240,0.1)] [&_.sign]:text-council-edit-ink [&_mark]:bg-[rgba(111,122,240,0.34)] [&_mark]:text-[#e3e6ff]",
  del: "bg-[rgba(217,95,138,0.08)] [&_.sign]:text-council-reject-ink [&_mark]:bg-[rgba(217,95,138,0.28)] [&_mark]:text-[#ffd3e2]",
  timing: "bg-[rgba(245,166,35,0.06)] [&_.sign]:text-unison-warn",
}

function Rows({ items }: { items: Item[] }) {
  return items.map((item, index) => {
    if ("gap" in item) {
      return (
        <div
          key={`${index}-gap-${item.gap.count}`}
          data-row="gap"
          className="bg-white/[0.03] px-3 py-0.5 text-[11px] text-unison-text-muted"
        >
          {plural(item.gap.count, "unchanged line", "unchanged lines")}
        </div>
      )
    }
    const { line } = item
    return (
      <div
        key={`${index}-${line.kind}-${line.lineNo}`}
        data-row={line.kind}
        className={cn(
          "grid grid-cols-[36px_16px_minmax(0,1fr)] [&_mark]:rounded-[3px] [&_mark]:px-px",
          ROW_TONE[line.kind],
        )}
      >
        <span className="px-2 text-right text-[rgba(245,245,247,0.28)] select-none">{line.lineNo}</span>
        <span className="sign text-center text-unison-text-muted">{SIGN[line.kind]}</span>
        <span className="code px-2 break-words whitespace-pre-wrap">
          <span className="text-unison-text-muted">{line.prefix}</span>
          {line.body}
          {line.note ? <span className="ml-2 text-[11px] text-unison-warn">{line.note}</span> : null}
        </span>
      </div>
    )
  })
}

function Fields({ fields, divided }: { fields: FieldRow[]; divided: boolean }) {
  return (
    <div className={cn("py-1", divided && "shadow-[inset_0_-1px_0_var(--color-unison-border)]")}>
      {fields.map((row) => (
        <div
          key={row.field}
          data-row="field"
          className="grid grid-cols-[88px_minmax(0,1fr)] items-baseline gap-2.5 px-3 [&_del]:rounded-[3px] [&_del]:px-1 [&_del]:no-underline [&_ins]:rounded-[3px] [&_ins]:px-1 [&_ins]:no-underline"
        >
          <span className="font-sans text-xs text-unison-text-muted">{FIELD_LABEL[row.field]}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 break-words">
            <del className="bg-[rgba(217,95,138,0.16)] text-[#ffd3e2]">{fieldValueText(row.field, row.before)}</del>
            <IconArrowRight aria-hidden className="size-3 shrink-0 text-unison-text opacity-50" stroke={1.75} />
            <ins className="bg-[rgba(111,122,240,0.2)] text-[#e3e6ff]">{fieldValueText(row.field, row.after)}</ins>
          </span>
        </div>
      ))}
    </div>
  )
}

export function DiffView({ rows, mode }: { rows: DiffRow[]; mode: DiffMode }) {
  const fields = rows.filter((row): row is FieldRow => row.kind === "field")
  const lines = rows.filter((row): row is LineRow => row.kind !== "field")
  if (fields.length === 0 && lines.length === 0) {
    return <p className="text-[13px] text-unison-text-muted">No line changes.</p>
  }
  return (
    <div className="relative overflow-hidden rounded-[10px] bg-black/[0.18] font-mono text-[12.5px] leading-[1.85] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--color-unison-border)]">
      {fields.length > 0 ? <Fields fields={fields} divided={lines.length > 0} /> : null}
      {lines.length === 0 ? null : mode === "split" ? (
        <div className="grid grid-cols-2 gap-x-4">
          <div data-side="before" className="min-w-0">
            <Rows items={side(lines, "before")} />
          </div>
          <div data-side="after" className="min-w-0">
            <Rows items={side(lines, "after")} />
          </div>
        </div>
      ) : (
        <Rows items={unified(lines)} />
      )}
    </div>
  )
}
