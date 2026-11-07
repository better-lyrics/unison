import type { DumpStats } from "@/services/dump-manifest"
import type { CSSProperties, ReactNode } from "react"
import { Frame, OgBrand, fill } from "./components"
import { MONO_STACK } from "./fonts"

export const PAGES = ["home", "leaderboard", "sealed", "docs", "downloads"] as const
export type Page = (typeof PAGES)[number]

export const PAGE_PATHS: Record<string, Page> = {
	"/": "home",
	"/curators": "leaderboard",
	"/sealed": "sealed",
	"/docs": "docs",
	"/downloads": "downloads",
}

const count = new Intl.NumberFormat("en-US")

export const formatCount = (n: number) => count.format(n)

function homeSubtitle(lyrics: number | null): [string, string, string] {
	if (lyrics === null) return ["The public database for synced lyrics, free to read.", "", ""]
	return [
		"The public database for synced lyrics, with ",
		formatCount(lyrics),
		" so far and all free to read.",
	]
}

export const PAGE_COPY = {
	home: {
		title: "Unison · Every word, on time",
		headline: ["Every word,", "on time."],
		subtitle: (lyrics: number | null) => homeSubtitle(lyrics).join(""),
	},
	leaderboard: {
		title: "Leaderboard · Unison",
		label: "Leaderboard",
		headline: ["Leaderboard"],
		subtitle: "Curators behind the community's top-rated lyrics.",
	},
	sealed: {
		title: "Sealed lyrics · Unison",
		label: "Sealed lyrics",
		headline: ["Council approved"],
		subtitle: "Our editors' choice: synced lyrics the Better Lyrics Council sealed.",
	},
	docs: {
		title: "Docs · Unison",
		label: "Docs",
		headline: ["Build on Unison"],
		subtitle: "Pull synced lyrics into your app without an API key.",
	},
	downloads: {
		title: "Downloads · Unison",
		label: "Downloads",
		headline: ["The whole", "database."],
		subtitle: "A daily snapshot of the lyrics and the request queue.",
	},
} as const

const LIT = "#fafafa"
const SUB = "rgba(245, 245, 247, 0.74)"
const GLASS: CSSProperties = {
	background: "rgba(18, 17, 22, 0.42)",
	boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.06)",
}

type Title = { size: number; tracking: number; wipeAt: number }

const TITLES: Record<Page, Title> = {
	home: { size: 104, tracking: -4, wipeAt: 46 },
	leaderboard: { size: 88, tracking: -3.4, wipeAt: 58 },
	sealed: { size: 80, tracking: -3, wipeAt: 60 },
	docs: { size: 80, tracking: -3, wipeAt: 55 },
	downloads: { size: 88, tracking: -3.4, wipeAt: 40 },
}

function KaraokeTitle({ page }: { page: Page }) {
	const lines = PAGE_COPY[page].headline
	const { size, tracking, wipeAt } = TITLES[page]
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				fontSize: size,
				fontWeight: 900,
				letterSpacing: tracking,
				lineHeight: 0.94,
			}}
		>
			{lines.map((line, i) =>
				i < lines.length - 1 ? (
					<span key={line} style={{ color: LIT, alignSelf: "flex-start" }}>
						{line}
					</span>
				) : (
					<span
						key={line}
						style={{
							alignSelf: "flex-start",
							backgroundImage: `linear-gradient(90deg, ${LIT} ${wipeAt}%, rgba(250, 250, 250, 0.32) ${wipeAt + 7}%)`,
							backgroundClip: "text",
							color: "transparent",
							padding: "0 0.1em 0.2em 0",
							margin: "0 -0.1em -0.2em 0",
						}}
					>
						{line}
					</span>
				)
			)}
		</div>
	)
}

function Subtitle({ children, width = 640 }: { children: ReactNode; width?: number }) {
	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				marginTop: 22,
				maxWidth: width,
				fontSize: 28,
				fontWeight: 500,
				color: SUB,
				textWrap: "pretty",
			}}
		>
			{children}
		</div>
	)
}

function PageFrame({
	page,
	wash,
	children,
	copy,
}: { page: Page; wash: string; children?: ReactNode; copy: ReactNode }) {
	const label = page === "home" ? undefined : PAGE_COPY[page].label
	return (
		<Frame>
			<img alt="" src={wash} style={{ ...fill, objectFit: "cover" }} />
			<div
				style={{
					...fill,
					background:
						"linear-gradient(90deg, rgba(10, 9, 13, 0.66), rgba(10, 9, 13, 0.38) 52%, rgba(10, 9, 13, 0.08) 78%)",
				}}
			/>
			<div
				style={{
					...fill,
					background: "linear-gradient(0deg, rgba(10, 9, 13, 0.45), transparent 46%)",
				}}
			/>
			<div style={{ ...fill, display: "flex", textShadow: "none" }}>
				{children}
				<div
					style={{
						position: "absolute",
						left: 64,
						bottom: 64,
						display: "flex",
						flexDirection: "column",
					}}
				>
					{copy}
				</div>
				<OgBrand left top={48} page={label} />
			</div>
		</Frame>
	)
}

export interface Curator {
	name: string
	avatar: string
	gem: string | null
	lyrics: number
	upvotes: number
}

export type PageCardData =
	| { page: "home"; wash: string; lyrics: number | null }
	| { page: "leaderboard"; wash: string; curators: Curator[] }
	| { page: "sealed"; wash: string; seal: string | null; covers: string[] }
	| { page: "docs"; wash: string }
	| {
			page: "downloads"
			wash: string
			stats: DumpStats | null
	  }

function HomeCard({ wash, lyrics }: { wash: string; lyrics: number | null }) {
	const [lead, number, rest] = homeSubtitle(lyrics)
	const subtitle = (
		<span>
			{lead}
			{number ? <span style={{ color: LIT, fontWeight: 700 }}>{number}</span> : null}
			{rest}
		</span>
	)
	return (
		<PageFrame
			page="home"
			wash={wash}
			copy={
				<>
					<KaraokeTitle page="home" />
					<Subtitle width={600}>{subtitle}</Subtitle>
				</>
			}
		/>
	)
}

function CuratorRow({ curator, rank }: { curator: Curator; rank: number }) {
	return (
		<div
			style={{
				...GLASS,
				display: "flex",
				alignItems: "center",
				gap: 16,
				height: 92,
				padding: "0 20px",
				borderRadius: 22,
			}}
		>
			<span
				style={{
					width: 24,
					fontSize: 26,
					fontWeight: 900,
					color: "rgba(245, 245, 247, 0.55)",
				}}
			>
				{String(rank)}
			</span>
			<img
				alt=""
				src={curator.avatar}
				style={{ width: 54, height: 54, borderRadius: 999, objectFit: "cover" }}
			/>
			<div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
				<span
					style={{
						fontSize: 24,
						fontWeight: 700,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
				>
					{curator.name}
				</span>
				<span
					style={{
						marginTop: 3,
						fontSize: 17,
						fontWeight: 500,
						color: "rgba(245, 245, 247, 0.64)",
					}}
				>
					{`${formatCount(curator.lyrics)} lyrics, ${formatCount(curator.upvotes)} upvotes`}
				</span>
			</div>
			{curator.gem ? (
				<img alt="" src={curator.gem} style={{ width: 44, height: 44, objectFit: "contain" }} />
			) : null}
		</div>
	)
}

function LeaderboardCard({ wash, curators }: { wash: string; curators: Curator[] }) {
	return (
		<PageFrame
			page="leaderboard"
			wash={wash}
			copy={
				<>
					<KaraokeTitle page="leaderboard" />
					<Subtitle width={540}>{PAGE_COPY.leaderboard.subtitle}</Subtitle>
				</>
			}
		>
			<div
				style={{
					position: "absolute",
					right: 64,
					top: 64,
					width: 400,
					display: "flex",
					flexDirection: "column",
					gap: 12,
				}}
			>
				{curators.map((curator, i) => (
					<CuratorRow key={curator.name} curator={curator} rank={i + 1} />
				))}
			</div>
		</PageFrame>
	)
}

const SHELF_TILT = [
	{ y: -34, deg: -6 },
	{ y: -6, deg: -2 },
	{ y: -42, deg: 4 },
	{ y: 4, deg: 8 },
]

function SealedCard({
	wash,
	seal,
	covers,
}: { wash: string; seal: string | null; covers: string[] }) {
	return (
		<PageFrame
			page="sealed"
			wash={wash}
			copy={
				<>
					<div style={{ display: "flex", alignItems: "center", gap: 22 }}>
						{seal ? (
							<img
								alt=""
								src={seal}
								style={{
									width: 84,
									height: 84,
									filter: "drop-shadow(0 10px 22px rgba(0, 0, 0, 0.4))",
								}}
							/>
						) : null}
						<KaraokeTitle page="sealed" />
					</div>
					<Subtitle width={540}>{PAGE_COPY.sealed.subtitle}</Subtitle>
				</>
			}
		>
			<div
				style={{
					position: "absolute",
					right: -30,
					top: 96,
					display: "flex",
					alignItems: "flex-end",
				}}
			>
				{covers.map((cover, i) => (
					<img
						key={cover}
						alt=""
						src={cover}
						style={{
							width: 190,
							height: 190,
							objectFit: "cover",
							borderRadius: 22,
							marginLeft: i === 0 ? 0 : -64,
							boxShadow: "0 22px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)",
							transform: `translateY(${SHELF_TILT[i].y}px) rotate(${SHELF_TILT[i].deg}deg)`,
						}}
					/>
				))}
			</div>
		</PageFrame>
	)
}

const RESPONSE: [string, string][] = [
	["format", "ttml"],
	["syncType", "richsync"],
	["confidence", "high"],
	["lyrics", "<tt>...</tt>"],
]

function DocsCard({ wash }: { wash: string }) {
	const key = (text: string) => <span style={{ color: LIT }}>{`"${text}"`}</span>
	return (
		<PageFrame
			page="docs"
			wash={wash}
			copy={
				<>
					<KaraokeTitle page="docs" />
					<Subtitle>{PAGE_COPY.docs.subtitle}</Subtitle>
				</>
			}
		>
			<div
				style={{
					...GLASS,
					position: "absolute",
					right: 64,
					top: 64,
					width: 540,
					display: "flex",
					flexDirection: "column",
					padding: "26px 30px",
					borderRadius: 24,
					whiteSpace: "pre",
					fontFamily: MONO_STACK,
					fontSize: 20,
					fontWeight: 500,
					lineHeight: 1.55,
					color: "rgba(245, 245, 247, 0.72)",
				}}
			>
				<span style={{ color: LIT, fontWeight: 700, marginBottom: 12 }}>
					GET /lyrics?apple_music=1438556832
				</span>
				<span>{"{"}</span>
				{RESPONSE.map(([name, value], i) => (
					<span key={name}>
						{"  "}
						{key(name)}
						{": "}
						<span style={{ color: "#f4d77a" }}>{`"${value}"`}</span>
						{i < RESPONSE.length - 1 ? "," : ""}
					</span>
				))}
				<span>{"}"}</span>
			</div>
		</PageFrame>
	)
}

function DownloadsCard({ wash, stats }: { wash: string; stats: DumpStats | null }) {
	const rows: [string, string][] = stats
		? [
				[formatCount(stats.lyrics), "lyrics"],
				[formatCount(stats.requested), "requested songs"],
				[`${Math.round(stats.bytes / 1_000_000)} MB`, "updated daily"],
			]
		: []
	return (
		<PageFrame
			page="downloads"
			wash={wash}
			copy={
				<>
					<KaraokeTitle page="downloads" />
					<Subtitle>{PAGE_COPY.downloads.subtitle}</Subtitle>
				</>
			}
		>
			<div
				style={{
					position: "absolute",
					right: 64,
					top: 92,
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-end",
					gap: 30,
					textAlign: "right",
				}}
			>
				{rows.map(([value, label]) => (
					<div
						key={label}
						style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}
					>
						<span
							style={{
								fontSize: 46,
								fontWeight: 700,
								letterSpacing: -1.2,
								lineHeight: 1,
							}}
						>
							{value}
						</span>
						<span
							style={{
								marginTop: 4,
								fontSize: 20,
								fontWeight: 500,
								color: "rgba(245, 245, 247, 0.66)",
							}}
						>
							{label}
						</span>
					</div>
				))}
			</div>
		</PageFrame>
	)
}

export function pageCardNode(card: PageCardData) {
	switch (card.page) {
		case "home":
			return <HomeCard wash={card.wash} lyrics={card.lyrics} />
		case "leaderboard":
			return <LeaderboardCard wash={card.wash} curators={card.curators} />
		case "sealed":
			return <SealedCard wash={card.wash} seal={card.seal} covers={card.covers} />
		case "docs":
			return <DocsCard wash={card.wash} />
		case "downloads":
			return <DownloadsCard wash={card.wash} stats={card.stats} />
	}
}
