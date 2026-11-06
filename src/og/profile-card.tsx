import type { CSSProperties, ReactNode } from "react"
import {
	EASED_FADE,
	Frame,
	GLASS,
	GOLD,
	type Inks,
	Logo,
	OgBrand,
	Pill,
	RIM,
	type RingGeometry,
	TEXT,
	TEXT_SHADOW,
	TierGem,
	XpAvatar,
	fill,
	fitLine,
} from "./components"
import { FONT_STACK } from "./fonts"

export interface Gem {
	art: string
	silhouette: string | null
}

export interface ProfileBase {
	name: string
	tier: string | null
	tierGem: Gem | null
	rank: number | null
	level: number
	progress: number
	avatar: string
	wash: string
	scrim: number
	ink: Inks
}

export interface ProfileWallData extends ProfileBase {
	covers: string[]
	stats: [string, string][] | null
}

export interface ProfileDownloadData extends ProfileBase {
	handle: string | null
	banner: string | null
	featured: Gem[]
	stats: [string, string][]
}

export const CARD_SIZE = { width: 400, height: 560 }

const WALL_RING: RingGeometry = {
	radius: 46.25,
	stroke: 3.75,
	face: 8.75,
	pillHeight: 27.5,
	pillWidth: { narrow: 27.5, wide: 36.25 },
	offset: 2.5,
	gap: 3.125,
	font: 13.75,
}

const CARD_RING: RingGeometry = {
	radius: 47,
	stroke: 3,
	face: 8,
	pillHeight: 22,
	pillWidth: { narrow: 22, wide: 30 },
	offset: 2,
	gap: 4,
	font: 11.5,
}

const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const WALL_FULL = { cols: 5, rows: 4, tile: 190, gap: 16, right: -170, top: -70 }
const WALL_SHORT = { cols: 4, rows: 3, tile: 250, gap: 18, right: -150, top: -80 }
const FAN = [
	{ right: 70, top: 120, rotate: "6deg", size: 330 },
	{ right: 210, top: 150, rotate: "-4deg", size: 320 },
	{ right: 330, top: 190, rotate: "-12deg", size: 290 },
]

// The row offset keeps a repeated cover from sitting beside its copy
function Covers({ covers, style }: { covers: string[]; style: CSSProperties }) {
	if (covers.length <= FAN.length) {
		return (
			<div style={{ ...fill, display: "flex", ...style }}>
				{FAN.slice(0, covers.length)
					.map((f, i) => ({ ...f, src: covers[i] }))
					.reverse()
					.map((f) => (
						<img
							alt=""
							key={f.src}
							src={f.src}
							style={{
								position: "absolute",
								right: f.right,
								top: f.top,
								width: f.size,
								height: f.size,
								borderRadius: 24,
								objectFit: "cover",
								rotate: f.rotate,
								boxShadow:
									"0 30px 70px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
							}}
						/>
					))}
			</div>
		)
	}
	const full = covers.length >= WALL_FULL.cols * WALL_FULL.rows
	const wall = full ? WALL_FULL : WALL_SHORT
	const tiles = Array.from({ length: wall.cols * wall.rows }, (_, i) => {
		const r = Math.floor(i / wall.cols)
		const c = i % wall.cols
		return full ? covers[i] : covers[(c + r * 2) % covers.length]
	})
	return (
		<div style={{ ...fill, display: "flex", ...style }}>
			<div
				style={{
					position: "absolute",
					right: wall.right,
					top: wall.top,
					width: wall.cols * wall.tile + (wall.cols - 1) * wall.gap,
					display: "flex",
					flexWrap: "wrap",
					gap: wall.gap,
					rotate: "-8deg",
				}}
			>
				{tiles.map((src, i) => (
					<img
						alt=""
						// biome-ignore lint/suspicious/noArrayIndexKey: tiles repeat covers by design
						key={i}
						src={src}
						style={{ width: wall.tile, height: wall.tile, borderRadius: 20, objectFit: "cover" }}
					/>
				))}
			</div>
		</div>
	)
}

function WallStats({ items, ink }: { items: [string, string][]; ink: string }) {
	return (
		<div style={{ display: "flex", gap: 48 }}>
			{items.map(([value, label]) => (
				<div key={label} style={{ display: "flex", flexDirection: "column" }}>
					<span style={{ fontSize: 52, fontWeight: 900, letterSpacing: -1.5, lineHeight: 1 }}>
						{value}
					</span>
					<span style={{ marginTop: 8, fontSize: 20, color: ink, fontWeight: 500 }}>{label}</span>
				</div>
			))}
		</div>
	)
}

export function profileWallNode(card: ProfileWallData) {
	const nameSize = 76
	const textRight = Math.round(
		64 + Math.max(Math.min(card.name.length * nameSize * 0.56, 620), 440)
	)
	const fan = card.covers.length <= FAN.length
	return (
		<Frame>
			<img alt="" src={card.wash} style={fill} />
			{card.covers.length === 0 || fan ? null : (
				<Covers
					covers={card.covers}
					style={{
						filter: "blur(28px) saturate(1.2)",
						maskImage: `linear-gradient(to right, transparent ${textRight - 120}px, black ${textRight + 60}px)`,
					}}
				/>
			)}
			{card.covers.length === 0 ? null : (
				<Covers
					covers={card.covers}
					style={{
						maskImage: `linear-gradient(to right, transparent ${textRight + (fan ? -40 : 40)}px, rgba(0,0,0,0.5) ${textRight + (fan ? 60 : 180)}px, black ${textRight + (fan ? 140 : 320)}px)`,
					}}
				/>
			)}
			<div
				style={{
					...fill,
					background: `linear-gradient(90deg, rgba(10, 9, 13, ${card.scrim}) 30%, transparent 70%)`,
				}}
			/>
			<div
				style={{
					position: "absolute",
					left: 64,
					top: 64,
					bottom: 100,
					width: 620,
					display: "flex",
					flexDirection: "column",
				}}
			>
				<XpAvatar
					src={card.avatar}
					level={card.level}
					progress={card.progress}
					tiered={Boolean(card.tier)}
					size={160}
					ring={WALL_RING}
					style={{ marginLeft: -14, marginTop: -14 }}
				/>
				<span
					style={{
						marginTop: 14,
						fontSize: nameSize,
						fontWeight: 900,
						letterSpacing: -nameSize * 0.04,
						lineHeight: 1.08,
						...fitLine(620),
					}}
				>
					{card.name}
				</span>
				<div style={{ display: "flex", gap: 10, marginTop: 16 }}>
					{card.tier && card.tierGem ? (
						<Pill icon={<TierGem {...card.tierGem} size={30} />}>{titleCase(card.tier)}</Pill>
					) : (
						<Pill>New curator</Pill>
					)}
					{card.rank === null ? null : <Pill gold>{`Rank #${card.rank}`}</Pill>}
				</div>
				<div style={{ display: "flex", marginTop: "auto" }}>
					{card.stats ? (
						<WallStats items={card.stats} ink={card.ink.three} />
					) : (
						<span style={{ fontSize: 30, color: card.ink.two, fontWeight: 500 }}>
							No songs synced yet
						</span>
					)}
				</div>
			</div>
			<OgBrand />
		</Frame>
	)
}

function GlassPill({ children, style }: { children: ReactNode; style: CSSProperties }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				height: 36,
				borderRadius: 999,
				whiteSpace: "nowrap",
				fontWeight: 700,
				background: GLASS,
				backdropFilter: "blur(24px) saturate(150%)",
				boxShadow: RIM,
				textShadow: "none",
				...style,
			}}
		>
			{children}
		</div>
	)
}

function cardNameSize(name: string): number {
	if (name.length <= 12) return 40
	return name.length <= 20 ? 33.6 : 28
}

export function profileDownloadNode(card: ProfileDownloadData) {
	const nameSize = cardNameSize(card.name)
	return (
		<div
			style={{
				position: "relative",
				display: "flex",
				width: "100%",
				height: "100%",
				overflow: "hidden",
				borderRadius: 28,
				background: "#121116",
				color: TEXT,
				fontFamily: FONT_STACK,
				textShadow: TEXT_SHADOW,
			}}
		>
			<img alt="" src={card.wash} style={fill} />
			{card.banner ? (
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						width: "100%",
						height: "64%",
						display: "flex",
						overflow: "hidden",
					}}
				>
					<img
						alt=""
						src={card.banner}
						style={{
							position: "absolute",
							top: -40,
							left: -40,
							width: CARD_SIZE.width + 80,
							height: CARD_SIZE.height * 0.64 + 40,
							objectFit: "cover",
							filter: "blur(40px) saturate(1.4)",
							maskImage: `linear-gradient(180deg, #000 40%, ${EASED_FADE})`,
						}}
					/>
					<img
						alt=""
						src={card.banner}
						style={{
							...fill,
							objectFit: "cover",
							maskImage: `linear-gradient(180deg, #000 0%, #000 46%, ${EASED_FADE} 90%, transparent)`,
						}}
					/>
				</div>
			) : null}
			<div
				style={{
					...fill,
					background: `linear-gradient(180deg, rgba(10, 9, 13, ${card.scrim * 0.4}), transparent 22%, transparent 42%, rgba(10, 9, 13, ${card.scrim + 0.1}))`,
				}}
			/>
			<div
				style={{
					...fill,
					display: "flex",
					flexDirection: "column",
					padding: 24,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
					<GlassPill style={{ gap: 8, padding: "0 14px 0 9px", fontSize: 14 }}>
						<Logo size={20} />
						Unison
					</GlassPill>
					{card.tier ? (
						<GlassPill style={{ gap: 6, padding: "0 12px 0 9px", fontSize: 13 }}>
							{card.tierGem ? <TierGem {...card.tierGem} size={20} /> : null}
							{titleCase(card.tier)}
							{card.rank === null ? null : (
								<span style={{ marginLeft: 2, color: GOLD }}>{`#${card.rank}`}</span>
							)}
						</GlassPill>
					) : null}
				</div>
				<XpAvatar
					src={card.avatar}
					level={card.level}
					progress={card.progress}
					tiered={Boolean(card.tier)}
					size={116}
					ring={CARD_RING}
					style={{ marginTop: "auto" }}
				/>
				<span
					style={{
						marginTop: 14,
						fontSize: nameSize,
						fontWeight: 900,
						lineHeight: 1.08,
						letterSpacing: "-0.035em",
						lineClamp: 2,
						textWrap: "balance",
						overflowWrap: "anywhere",
						paddingRight: "0.08em",
						paddingBottom: "0.08em",
						marginRight: "-0.08em",
						marginBottom: "-0.08em",
					}}
				>
					{card.name}
				</span>
				{card.handle ? (
					<span style={{ marginTop: 10, fontSize: 14, fontWeight: 500, color: card.ink.three }}>
						{`@${card.handle}`}
					</span>
				) : null}
				{card.featured.length > 0 ? (
					<div style={{ display: "flex", gap: 6, marginTop: 14 }}>
						{card.featured.map((gem) => (
							<TierGem key={gem.art} art={gem.art} silhouette={gem.silhouette} size={28} />
						))}
					</div>
				) : null}
				<div
					style={{
						display: "flex",
						gap: 22,
						marginTop: 20,
						paddingTop: 18,
						borderTop: "1px solid rgba(255, 255, 255, 0.03)",
					}}
				>
					{card.stats.map(([value, label]) => (
						<div key={label} style={{ display: "flex", flexDirection: "column" }}>
							<span
								style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.03em" }}
							>
								{value}
							</span>
							<span style={{ marginTop: 6, fontSize: 12, color: card.ink.three }}>{label}</span>
						</div>
					))}
				</div>
			</div>
			<div style={{ ...fill, borderRadius: 28, boxShadow: RIM }} />
		</div>
	)
}
