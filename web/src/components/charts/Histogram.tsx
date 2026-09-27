import { chartMax, roundedTopPath } from "./scale"

export interface HistogramBucket {
  label: string
  value: number
}

interface HistogramProps {
  buckets: HistogramBucket[]
  color: string
  ariaLabel: string
}

const W = 540
const H = 200
const PAD = { top: 18, bottom: 20, side: 4 }

export function Histogram({ buckets, color, ariaLabel }: HistogramProps) {
  const max = chartMax(
    buckets.map((b) => b.value),
    1,
  )
  const step = (W - PAD.side * 2) / Math.max(1, buckets.length)
  const barWidth = step - 14
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="block h-auto w-full overflow-visible">
      <line x1={0} x2={W} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.08)" />
      {buckets.map((b, i) => {
        const height = ((H - PAD.top - PAD.bottom) * b.value) / max
        const x = PAD.side + i * step + 7
        const top = H - PAD.bottom - height
        return (
          <g key={b.label} data-bucket={b.label}>
            <title>{`${b.label}: ${b.value} waiting`}</title>
            {b.value > 0 ? (
              <path
                d={roundedTopPath(x, top, barWidth, height, 4)}
                fill={color}
                opacity={0.55 + (i / Math.max(1, buckets.length)) * 0.45}
              />
            ) : null}
            <text
              x={x + barWidth / 2}
              y={top - 6}
              textAnchor="middle"
              className="fill-unison-text-secondary font-mono text-[11px]"
            >
              {b.value}
            </text>
            <text
              x={x + barWidth / 2}
              y={H - 4}
              textAnchor="middle"
              className="fill-unison-text-muted font-mono text-[10px]"
            >
              {b.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
