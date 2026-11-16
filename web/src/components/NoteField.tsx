import type { KeyboardEvent, Ref } from "react"

interface NoteFieldProps {
  id: string
  label: string
  max: number
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  inputRef?: Ref<HTMLTextAreaElement>
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

export function NoteField({ id, label, max, value, onChange, placeholder, rows, inputRef, onKeyDown }: NoteFieldProps) {
  return (
    <>
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-xs text-unison-text-muted">
        {label}
        <span className="font-mono text-[10px] tabular-nums">
          {value.length}/{max}
        </span>
      </label>
      <textarea
        id={id}
        ref={inputRef}
        value={value}
        rows={rows}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="min-h-16 w-full resize-y rounded-md border border-unison-border bg-unison-bg/60 px-2.5 py-2 text-[13px] leading-normal outline-none transition-colors focus:border-unison-border-strong"
      />
    </>
  )
}
