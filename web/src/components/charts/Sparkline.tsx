interface SparklineProps {
  values: number[]
  label: string
  width?: number
  height?: number
  color?: string
}

export function Sparkline({
  values,
  label,
  width = 96,
  height = 26,
  color = "var(--color-council-edit)",
}: SparklineProps) {
  const max = Math.max(1, ...values)
  const points = values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 4) + 2
    const y = height - 3 - (v / max) * (height - 6)
    return [x, y] as const
  })
  const last = points.at(-1)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {points.length > 1 ? (
        <polyline
          points={points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {last ? <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke="#141318" strokeWidth={2} /> : null}
    </svg>
  )
}
