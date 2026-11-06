import type { SyncKind } from "@/utils/sync-type"
import type { CSSProperties } from "react"
import { Frame, type Inks, OgBrand, Pill, SyncTag, TEXT, fill, fitLine } from "./components"

export interface SongCardData {
	song: string
	artist: string
	album: string | null
	sync: SyncKind
	versions: number
	sealed: boolean
	submitter: { displayName: string; avatar: string } | null
	cover: string
	wash: string
	seal: string | null
	scrim: number
	ink: Inks
}

const EASED =
	"linear-gradient(to right, transparent 0%, rgba(0,0,0,0.04) 10%, rgba(0,0,0,0.14) 20%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0.7) 50%, rgba(0,0,0,0.86) 60%, rgba(0,0,0,0.96) 70%, black 80%)"

function titleSize(song: string): number {
	if (song.length <= 14) return 80
	return song.length <= 24 ? 68 : 56
}

export function songCardNode(card: SongCardData) {
	const size = titleSize(card.song)
	return (
		<Frame>
			<img alt="" src={card.wash} style={fill} />
			<img
				alt=""
				src={card.cover}
				style={{
					position: "absolute",
					right: -60,
					top: -60,
					width: 900,
					height: 750,
					objectFit: "cover",
					filter: "blur(36px) saturate(1.3)",
					maskImage: EASED,
				}}
			/>
			<img
				alt=""
				src={card.cover}
				style={{
					position: "absolute",
					right: 0,
					top: 0,
					width: 630,
					height: 630,
					objectFit: "cover",
					objectPosition: "60% 50%",
					maskImage: EASED,
				}}
			/>
			<div
				style={{
					...fill,
					background: `linear-gradient(90deg, rgba(10, 9, 13, ${card.scrim}), rgba(10, 9, 13, ${card.scrim * 0.55}) 50%, transparent 72%)`,
				}}
			/>
			{card.sealed && card.seal ? (
				<img
					alt=""
					src={card.seal}
					style={{
						position: "absolute",
						right: 60,
						bottom: 56,
						width: 118,
						height: 118,
						rotate: "-9deg",
						filter: "drop-shadow(0 14px 22px rgba(0, 0, 0, 0.45))",
					}}
				/>
			) : null}
			<div
				style={{
					position: "absolute",
					left: 64,
					top: 130,
					bottom: 100,
					width: 540,
					display: "flex",
					flexDirection: "column",
					justifyContent: "flex-end",
				}}
			>
				<span
					style={
						{
							fontSize: size,
							fontWeight: 900,
							letterSpacing: -size * 0.035,
							lineHeight: 1.08,
							lineClamp: 2,
							textWrap: "balance",
						} as CSSProperties
					}
				>
					{card.song}
				</span>
				<span style={{ marginTop: 12, fontSize: 28, fontWeight: 500, ...fitLine(540) }}>
					<span style={{ color: card.ink.two }}>{card.artist}</span>
					{card.album ? <span style={{ color: card.ink.three }}>{` · ${card.album}`}</span> : null}
				</span>
				<div style={{ display: "flex", gap: 10, marginTop: 24 }}>
					<SyncTag kind={card.sync} ink={card.ink} />
					{card.versions > 1 ? <Pill>{`${card.versions} versions`}</Pill> : null}
				</div>
				{card.submitter ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 14,
							marginTop: 24,
							fontSize: 22,
							color: card.ink.three,
							fontWeight: 500,
						}}
					>
						<img
							alt=""
							src={card.submitter.avatar}
							style={{ width: 44, height: 44, borderRadius: 999, objectFit: "cover" }}
						/>
						Synced by
						<span style={{ color: TEXT, fontWeight: 700, ...fitLine(360) }}>
							{card.submitter.displayName}
						</span>
					</div>
				) : null}
			</div>
			<OgBrand left />
		</Frame>
	)
}
