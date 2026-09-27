import { cn } from "@/lib/cn"
import { IconChevronDown } from "@tabler/icons-react"
import { useState } from "react"
import { tooltipSurfaceClass } from "../ui"
import { axisTicks, chartMax, roundedTopPath } from "./scale"

export interface BarSeries {
  key: string
  label: string
  color: string
  values: number[]
}

interface StackedBarsProps {
  series: BarSeries[]
  labels: string[]
  axisLabelAt: number[]
  ariaLabel: string
}

const W = 860
const H = 200
const PAD = { left: 24, right: 4, top: 8, bottom: 20 }
const GAP = 2

export function StackedBars({ series, labels, axisLabelAt, ariaLabel }: StackedBarsProps) {
  const [hover, setHover] = useState<number | null>(null)
  const count = labels.length
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0))
  const max = chartMax(totals)
  const step = (W - PAD.left - PAD.right) / Math.max(1, count)
  const barWidth = Math.max(4, step - 6)
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / max)

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-unison-text-secondary">
        {series.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: s.color }} />
            {s.label}
            <b className="font-mono font-medium text-unison-text tabular-nums">{s.values.reduce((a, b) => a + b, 0)}</b>
          </li>
        ))}
      </ul>
      <div className="relative" onPointerLeave={() => setHover(null)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={ariaLabel}
          className="block h-auto w-full overflow-visible"
        >
          <g>
            {axisTicks(max).map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
                <text
                  x={PAD.left - 8}
                  y={y(t) + 3}
                  textAnchor="end"
                  className="fill-unison-text-muted font-mono text-[10px]"
                >
                  {t}
                </text>
              </g>
            ))}
            {axisLabelAt.map((i) => (
              <text
                key={i}
                x={PAD.left + i * step + step / 2}
                y={H - 4}
                textAnchor="middle"
                className="fill-unison-text-muted font-mono text-[10px]"
              >
                {labels[i]}
              </text>
            ))}
          </g>
          {labels.map((label, i) => {
            const x = PAD.left + i * step + (step - barWidth) / 2
            const present = series.filter((s) => (s.values[i] ?? 0) > 0)
            let acc = 0
            return (
              <g
                key={label}
                data-column={i}
                onPointerEnter={() => setHover(i)}
                className={cn("transition-opacity", hover !== null && hover !== i && "opacity-35")}
              >
                {present.map((s, k) => {
                  const value = s.values[i] ?? 0
                  const top = y(acc + value)
                  const height = Math.max(1, y(acc) - top - (k > 0 ? GAP : 0))
                  acc += value
                  return k === present.length - 1 ? (
                    <path key={s.key} d={roundedTopPath(x, top, barWidth, height, 4)} fill={s.color} />
                  ) : (
                    <rect key={s.key} x={x} y={top} width={barWidth} height={height} fill={s.color} />
                  )
                })}
                <rect
                  x={PAD.left + i * step}
                  y={PAD.top}
                  width={step}
                  height={H - PAD.top - PAD.bottom}
                  fill="transparent"
                />
              </g>
            )
          })}
        </svg>
        {hover !== null ? (
          <div
            role="presentation"
            className={cn(
              "pointer-events-none absolute top-1 z-10 min-w-[150px] -translate-x-1/2",
              tooltipSurfaceClass,
            )}
            style={{ left: `${((PAD.left + hover * step + step / 2) / W) * 100}%` }}
          >
            <div className="mb-0.5 text-unison-text-muted">{labels[hover]}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-[2px]" style={{ background: s.color }} />
                {s.label}
                <b className="ml-auto pl-3 font-mono font-medium tabular-nums">{s.values[hover] ?? 0}</b>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <details className="group mt-1.5">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-unison-text-muted transition-colors hover:text-unison-text">
          <IconChevronDown className="size-3 transition-transform group-open:rotate-180" stroke={1.5} />
          Show as table
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-unison-text-muted">
              <th className="px-1.5 py-1 text-left font-medium">Day</th>
              {series.map((s) => (
                <th key={s.key} className="px-1.5 py-1 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono text-unison-text-secondary tabular-nums">
            {labels.map((label, i) => (
              <tr key={label}>
                <td className="px-1.5 py-1">{label}</td>
                {series.map((s) => (
                  <td key={s.key} className="px-1.5 py-1 text-right">
                    {s.values[i] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
