import type { QrModules } from "./qr"
import { SYNC_KINDS, type SyncKind } from "@/utils/sync-type"
import type { CSSProperties, ReactNode } from "react"
import { FONT_STACK } from "./fonts"

export const TEXT = "#f5f5f7"
export const GOLD = "#ffc83d"
export const TEXT_SHADOW = "0 1px 16px rgba(0, 0, 0, 0.3)"
export const GLASS = "rgba(15, 14, 19, 0.28)"
export const RIM =
	"inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.06)"
export const EASED_FADE =
	"rgba(0,0,0,0.96), rgba(0,0,0,0.86), rgba(0,0,0,0.7), rgba(0,0,0,0.5), rgba(0,0,0,0.3), rgba(0,0,0,0.14), rgba(0,0,0,0.04), transparent"

export const fill: CSSProperties = {
	position: "absolute",
	top: 0,
	left: 0,
	width: "100%",
	height: "100%",
}

export type Inks = { two: string; three: string }

export function inksFor(ink: Record<"--ink-2" | "--ink-3", string>): Inks {
	return { two: ink["--ink-2"], three: ink["--ink-3"] }
}

// The padding keeps descenders out of the clip
export const fitLine = (width: number): CSSProperties => ({
	width,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	textFit: "shrink consistent 70%",
	paddingBottom: "0.16em",
	marginBottom: "-0.16em",
})

export function Frame({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				position: "relative",
				display: "flex",
				width: "100%",
				height: "100%",
				overflow: "hidden",
				background: "#121116",
				color: TEXT,
				fontFamily: FONT_STACK,
				textShadow: TEXT_SHADOW,
			}}
		>
			{children}
		</div>
	)
}

export function Logo({ size }: { size: number }) {
	const inner =
		"M 216.877 101.494 C 129.312 123.247 77.337 215.006 103.18 301.61 C 121.687 363.631 176.581 409.295 240.38 414.757 C 287.712 418.809 329.728 405.453 364.631 372.705 C 402.973 336.73 419.903 291.754 414.474 239.817 C 408.507 182.738 378.509 140.758 327.553 113.442 C 291.849 96.169 254.947 92.037 216.877 101.494 Z M 111.49 258.009 C 111.657 203.346 135.045 160.293 181.947 132.029 C 257.535 86.476 354.347 118.494 389.27 199.487 C 425.321 283.1 374.187 380.741 284.761 397.772 C 230.539 408.099 184.56 391.825 147.1 351.356 C 123.778 324.1 111.384 293.035 111.49 258.009 Z M 275.782 205.816 C 285.751 205.816 295.066 205.859 304.381 205.802 C 312.272 205.755 316.316 201.706 316.432 193.751 C 316.512 188.253 316.544 182.75 316.422 177.253 C 316.252 169.635 312.169 165.693 304.507 165.667 C 292.342 165.626 280.176 165.637 268.011 165.66 C 259.036 165.678 255.746 169.021 255.743 178.109 C 255.734 207.273 255.743 236.436 255.729 265.6 C 255.729 267.311 255.584 269.021 255.493 271.034 C 252.926 269.96 250.993 269 248.965 268.328 C 234.723 263.608 221.596 265.768 210.09 275.438 C 198.291 285.355 193.507 298.277 196.25 313.409 C 200.094 334.613 218.73 348.223 240.237 346.153 C 260.242 344.228 275.646 326.851 275.757 305.878 C 275.856 287.047 275.781 268.215 275.782 248.883 C 275.782 234.286 275.782 220.188 275.782 205.816 Z"
	return (
		<svg
			aria-hidden="true"
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 512 512"
			width={size}
			height={size}
		>
			<path
				fill="#F20C32"
				d={`M 512 256 C 512 397.385 397.385 512 256 512 C 114.615 512 0 397.385 0 256 C 0 114.615 114.615 0 256 0 C 397.385 0 512 114.615 512 256 Z ${inner}`}
			/>
			<path fill="#fff" d={inner} />
		</svg>
	)
}

export function QrCode({ qr, size, color }: { qr: QrModules; size: number; color: string }) {
	const eye = (x: number, y: number) => (
		<g key={`${x}-${y}`}>
			<rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={2} fill="none" stroke={color} strokeWidth={1} />
			<rect x={x + 2} y={y + 2} width={3} height={3} rx={1} fill={color} />
		</g>
	)
	const logo = (qr.hole.size - 0.8) * (size / qr.size)
	return (
		<div style={{ position: "relative", display: "flex", width: size, height: size, flexShrink: 0 }}>
			<svg
				aria-hidden="true"
				xmlns="http://www.w3.org/2000/svg"
				viewBox={`0 0 ${qr.size} ${qr.size}`}
				width={size}
				height={size}
			>
				{qr.dots.map(([x, y]) => (
					<circle key={`${x}-${y}`} cx={x + 0.5} cy={y + 0.5} r={0.42} fill={color} />
				))}
				{eye(0, 0)}
				{eye(qr.size - 7, 0)}
				{eye(0, qr.size - 7)}
			</svg>
			<div
				style={{
					position: "absolute",
					top: (size - logo) / 2,
					left: (size - logo) / 2,
					display: "flex",
				}}
			>
				<Logo size={logo} />
			</div>
		</div>
	)
}

export function OgBrand({ left }: { left?: boolean }) {
	return (
		<div
			style={{
				position: "absolute",
				top: 40,
				...(left ? { left: 64 } : { right: 40 }),
				display: "flex",
				alignItems: "center",
				gap: 12,
				height: 60,
				padding: "0 22px 0 14px",
				borderRadius: 999,
				background: "rgba(18, 17, 22, 0.42)",
				backdropFilter: "blur(24px) saturate(160%)",
				boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.14), 0 8px 24px rgba(0, 0, 0, 0.25)",
				fontSize: 26,
				fontWeight: 700,
			}}
		>
			<div
				style={{
					display: "flex",
					width: 36,
					height: 36,
					borderRadius: 999,
					background: "#fff",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Logo size={36} />
			</div>
			Unison
		</div>
	)
}

const HALF = 0.5
const BAR_OPACITY: Record<SyncKind, [number, number, number]> = {
	syllable: [HALF, 1, HALF],
	word: [HALF, 1, 1],
	line: [1, 1, 1],
	unsynced: [HALF, HALF, HALF],
}

export function SyncIcon({ kind, size, color }: { kind: SyncKind; size: number; color: string }) {
	const [a, b, c] = BAR_OPACITY[kind]
	return (
		<svg
			aria-hidden="true"
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 1024 1024"
			width={size}
			height={size}
			fill={color}
		>
			<rect x="636" y="239" width="389.981" height="233.271" rx="48" fillOpacity={a} />
			<path
				fillOpacity={b}
				d="M0 335C0 289.745 0 267.118 14.0589 253.059C28.1177 239 50.7452 239 96 239H213C243.17 239 258.255 239 267.627 248.373C277 257.745 277 272.83 277 303V408C277 438.17 277 453.255 267.627 462.627C258.255 472 243.17 472 213 472H96C50.7452 472 28.1177 472 14.0589 457.941C0 443.882 0 421.255 0 376V335Z"
			/>
			<path
				fillOpacity={c}
				d="M337 304C337 273.83 337 258.745 346.373 249.373C355.745 240 370.83 240 401 240H460C505.255 240 527.882 240 541.941 254.059C556 268.118 556 290.745 556 336V377C556 422.255 556 444.882 541.941 458.941C527.882 473 505.255 473 460 473H401C370.83 473 355.745 473 346.373 463.627C337 454.255 337 439.17 337 409V304Z"
			/>
			<rect y="552.271" width="1024" height="233" rx="48" fillOpacity={HALF} />
		</svg>
	)
}

export function SyncTag({ kind, ink }: { kind: SyncKind; ink: Inks }) {
	const look = SYNC_KINDS[kind]
	const color = look.color ?? ink.three
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				height: 46,
				padding: "0 18px 0 14px",
				borderRadius: 14,
				cornerShape: "superellipse(1.6)",
				background: look.tint,
				backdropFilter: "blur(16px)",
				color,
				fontSize: 20,
				fontWeight: 700,
			}}
		>
			<SyncIcon kind={kind} size={24} color={color} />
			{look.label}
		</div>
	)
}

export function Pill({
	children,
	gold,
	icon,
}: { children: ReactNode; gold?: boolean; icon?: ReactNode }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				height: 46,
				padding: icon ? "0 20px 0 12px" : "0 20px",
				borderRadius: 999,
				fontSize: 20,
				fontWeight: 700,
				background: gold ? "rgba(255, 200, 61, 0.16)" : "rgba(255, 255, 255, 0.12)",
				backdropFilter: "blur(16px)",
				boxShadow: gold
					? "inset 0 0 0 1px rgba(255, 200, 61, 0.3)"
					: "inset 0 0 0 1px rgba(255, 255, 255, 0.12)",
				color: gold ? GOLD : TEXT,
			}}
		>
			{icon}
			{children}
		</div>
	)
}

export function TierGem({
	art,
	silhouette,
	size,
}: { art: string; silhouette: string | null; size: number }) {
	return (
		<div
			style={{ position: "relative", display: "flex", width: size, height: size, flexShrink: 0 }}
		>
			{silhouette ? (
				<img alt="" src={silhouette} style={{ ...fill, objectFit: "contain" }} />
			) : null}
			<img alt="" src={art} style={{ ...fill, objectFit: "contain" }} />
		</div>
	)
}

export interface RingGeometry {
	radius: number
	stroke: number
	face: number
	pillHeight: number
	pillWidth: { narrow: number; wide: number }
	offset: number
	gap: number
	font: number
}

function holeMask(ring: RingGeometry, level: number): string {
	const pillWidth = level < 10 ? ring.pillWidth.narrow : ring.pillWidth.wide
	const width = pillWidth + 2 * ring.gap
	const height = ring.pillHeight + 2 * ring.gap
	const x = 100 - ring.offset - pillWidth - ring.gap
	const y = 100 - ring.offset - ring.pillHeight - ring.gap
	const r = height / 2
	const straight = width - 2 * r
	const svg = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><path fill-rule="evenodd" d="M0 0H100V100H0Z M${x + r} ${y}h${straight}a${r} ${r} 0 0 1 0 ${height}h-${straight}a${r} ${r} 0 0 1 0-${height}Z"/></svg>`
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export function XpAvatar({
	src,
	level,
	progress,
	tiered,
	size,
	ring,
	style,
}: {
	src: string
	level: number
	progress: number
	tiered: boolean
	size: number
	ring: RingGeometry
	style?: CSSProperties
}) {
	const unit = size / 100
	const circumference = 2 * Math.PI * ring.radius
	const pillWidth = (level < 10 ? ring.pillWidth.narrow : ring.pillWidth.wide) * unit
	const face = size - 2 * ring.face * unit
	return (
		<div
			style={{
				position: "relative",
				display: "flex",
				width: size,
				height: size,
				flexShrink: 0,
				...style,
			}}
		>
			<div
				style={{
					...fill,
					display: "flex",
					maskImage: holeMask(ring, level),
					maskSize: "100% 100%",
				}}
			>
				<svg
					aria-hidden="true"
					xmlns="http://www.w3.org/2000/svg"
					width={size}
					height={size}
					viewBox="0 0 100 100"
					style={{ position: "absolute", top: 0, left: 0, rotate: "-90deg" }}
				>
					<circle
						cx="50"
						cy="50"
						r={ring.radius}
						fill="none"
						stroke="rgba(255,255,255,0.18)"
						strokeWidth={ring.stroke}
					/>
					{progress > 0 ? (
						<circle
							cx="50"
							cy="50"
							r={ring.radius}
							fill="none"
							stroke={tiered ? GOLD : TEXT}
							strokeWidth={ring.stroke}
							strokeLinecap="round"
							strokeDasharray={`${circumference}`}
							strokeDashoffset={`${circumference * (1 - progress)}`}
						/>
					) : null}
				</svg>
				<img
					alt=""
					src={src}
					style={{
						position: "absolute",
						top: ring.face * unit,
						left: ring.face * unit,
						width: face,
						height: face,
						borderRadius: 999,
						objectFit: "cover",
					}}
				/>
			</div>
			<div
				style={{
					position: "absolute",
					right: ring.offset * unit,
					bottom: ring.offset * unit,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: pillWidth,
					height: ring.pillHeight * unit,
					borderRadius: 999,
					background: TEXT,
					color: "#121116",
					fontSize: ring.font * unit,
					fontWeight: 900,
					textShadow: "none",
				}}
			>
				{String(level)}
			</div>
		</div>
	)
}
