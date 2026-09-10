import { cn } from "@/lib/cn"
import type { ChoicePart } from "@/lib/examApi"

interface ChoiceGroupProps {
  part: ChoicePart
  value?: string
  onChange: (optionId: string) => void
}

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
                "flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                "focus-within:outline-none focus-within:ring-2 focus-within:ring-unison-border-strong",
                selected
                  ? "bg-unison-bg-hover text-unison-text"
                  : "bg-white/[0.02] text-unison-text-secondary hover:bg-unison-bg-hover",
              )}
            >
              <input
                type="radio"
                name={part.part}
                value={option.id}
                checked={selected}
                onChange={() => onChange(option.id)}
                className="mt-0.5 accent-unison-text outline-none"
              />
              <span className="leading-relaxed">{option.label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
