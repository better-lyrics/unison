import type { ShowcaseApp } from "@/lib/showcase"
import { ShowcasePage } from "@/pages/ShowcasePage"

const STRESS_APPS: ShowcaseApp[] = [
  {
    name: "Tiny",
    featured: true,
    description: "Short.",
    url: "https://tiny.example",
    icon: "/logo.svg",
    platforms: [],
  },
  {
    name: "An Extremely Long Application Name That Keeps Going Well Past Any Sensible Length",
    description: "Name and URL both overflow the card header.",
    url: "https://github.com/a-very-long-organisation-name/an-even-longer-repository-name-for-testing",
    icon: "/showcase/mixmusic.png",
    iconFillsTile: true,
    platforms: ["Windows"],
  },
  {
    name: "Supercalifragilisticexpialidociousplayerwithoutspaces",
    description:
      "A description that runs far longer than the one line the issue form asks for. It keeps describing features, themes, plugins, visualisers, offline caching, scrobbling, equalisers and everything else, so the card grows much taller than its neighbours in the same row.",
    url: "https://music.example.org/apps/desktop/",
    icon: "/pfp/frog.webp",
    iconFillsTile: true,
    platforms: ["macOS", "Windows", "Linux", "Android", "iOS", "Web", "Chrome", "Firefox", "Edge", "Safari"],
  },
  {
    name: "Tag Soup",
    description: "One platform label with no spaces and one very long label.",
    url: "https://tagsoup.example",
    icon: "/pfp/butler.svg",
    platforms: ["Raspberry Pi OS (64-bit, Bookworm and later)", "SteamOSDeckDesktopModeOnlyBuild"],
  },
  {
    name: "Ünïcödé 歌詞プレーヤー",
    description: "Non-Latin name and description: 同期された歌詞をすべての曲で表示します。",
    url: "https://例え.jp/アプリ",
    icon: "/logo.svg",
    platforms: ["日本語", "Linux"],
  },
  {
    name: "Missing Icon",
    featured: true,
    description: "The icon path does not exist.",
    url: "https://missing.example",
    icon: "/showcase/does-not-exist.png",
    platforms: ["Web"],
  },
  {
    name: "Seventh App",
    featured: true,
    description: "Fills the grid so the last row is not full.",
    url: "https://seventh.example",
    icon: "/pfp/frog.webp",
    iconFillsTile: true,
    platforms: ["Android"],
  },
]

export default function DevShowcasePreview() {
  return <ShowcasePage apps={STRESS_APPS} />
}
