import type { ReactNode } from "react"

export function SectionHeading({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="m-0 text-xl font-bold tracking-[-0.01em] text-balance">{title}</h2>
      {meta ? <div className="ml-auto text-[13px] font-medium text-(--ink-3)">{meta}</div> : null}
    </div>
  )
}
