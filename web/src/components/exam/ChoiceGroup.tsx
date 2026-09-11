import { cn } from "@/lib/cn"
import type { ChoicePart } from "@/lib/examApi"
import { IconCheck } from "@tabler/icons-react"

interface ChoiceGroupProps {
  part: ChoicePart
  value?: string
  onChange: (optionId: string) => void
}

// Radio input stays for keyboard semantics but is visually hidden; the card shows selection.
export function ChoiceGroup({ part, value, onChange }: ChoiceGroupProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-xs font-medium text-unison-text-secondary">{part.label}</legend>
      <div className="space-y-2">
        {part.options.map((option) => {
          const selected = value === option.id
          return (
            <label
              key={option.id}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-sm transition-colors",
                "focus-within:outline-none focus-within:ring-2 focus-within:ring-unison-border-strong",
                selected
                  ? "border-unison-border bg-unison-bg-hover text-unison-text"
                  : "border-transparent bg-white/[0.02] text-unison-text-secondary hover:bg-unison-bg-hover",
              )}
            >
              <input
                type="radio"
                name={part.part}
                value={option.id}
                checked={selected}
                onChange={() => onChange(option.id)}
                className="sr-only"
              />
              <span className="leading-relaxed">{option.label}</span>
              <IconCheck
                className={cn("size-[18px] flex-none transition-opacity", selected ? "opacity-100" : "opacity-0")}
                stroke={2.5}
                aria-hidden
              />
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
