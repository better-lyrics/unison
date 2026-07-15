import type { ReactNode } from "react"
import { type CodeTab, CodeBlock, CodeLangProvider, CodeTabs } from "@/components/CodeBlock"

const BASE_URL = "https://unison.boidu.dev"

const VIDEO_URL = "https://unison.boidu.dev/lyrics?v=dQw4w9WgXcQ"
const SONG_ARTIST_URL = "https://unison.boidu.dev/lyrics?song=Never+Gonna+Give+You+Up&artist=Rick+Astley"
const SEARCH_URL = "https://unison.boidu.dev/lyrics/search?q=never+gonna+give"
const VARIANTS_URL = "https://unison.boidu.dev/lyrics/variants/dQw4w9WgXcQ?limit=5"

// A GET in each language, generated from the URL so every reference section stays in lockstep.
function fetchTabs(url: string): CodeTab[] {
  return [
    { label: "cURL", language: "bash", code: `curl "${url}"` },
    {
      label: "JavaScript",
      language: "javascript",
      code: `const res = await fetch("${url}")\nconst { success, data } = await res.json()`,
    },
    {
      label: "Python",
      language: "python",
      code: `import requests\n\nbody = requests.get("${url}").json()`,
    },
    {
      label: "Go",
      language: "go",
      code: `res, err := http.Get("${url}")\nif err != nil {\n    log.Fatal(err)\n}\ndefer res.Body.Close()\nbody, _ := io.ReadAll(res.Body)`,
    },
    {
      label: "Rust",
      language: "rust",
      code: `let body = reqwest::blocking::get(\n    "${url}",\n)?\n.text()?;`,
    },
  ]
}

// The quickstart teaches the full round trip, so its snippets parse and use the result.
const QUICKSTART_TABS: CodeTab[] = [
  { label: "cURL", language: "bash", code: `curl "${VIDEO_URL}"` },
  {
    label: "JavaScript",
    language: "javascript",
    code: `const res = await fetch("${VIDEO_URL}")
const { success, data } = await res.json()

if (success) {
  // data.format is "ttml" | "lrc" | "plain"
  // data.lyrics holds the synced text in that format
  render(data.lyrics, data.format)
}`,
  },
  {
    label: "Python",
    language: "python",
    code: `import requests

res = requests.get("https://unison.boidu.dev/lyrics", params={"v": "dQw4w9WgXcQ"})
body = res.json()

if body["success"]:
    data = body["data"]
    # data["format"] is "ttml" | "lrc" | "plain"
    render(data["lyrics"], data["format"])`,
  },
  {
    label: "Go",
    language: "go",
    code: `res, err := http.Get("${VIDEO_URL}")
if err != nil {
    log.Fatal(err)
}
defer res.Body.Close()

// body.data.lyrics holds the synced text in body.data.format
body, _ := io.ReadAll(res.Body)
fmt.Println(string(body))`,
  },
  {
    label: "Rust",
    language: "rust",
    code: `// reqwest = { version = "0.12", features = ["blocking"] }
let body = reqwest::blocking::get(
    "${VIDEO_URL}",
)?
.text()?;

// body.data.lyrics holds the synced text in body.data.format
println!("{body}");`,
  },
]

const VIDEO_RESPONSE = `{
  "success": true,
  "data": {
    "id": 4821,
    "videoId": "dQw4w9WgXcQ",
    "song": "Never Gonna Give You Up",
    "artist": "Rick Astley",
    "album": "Whenever You Need Somebody",
    "duration": 213,
    "format": "ttml",
    "syncType": "richsync",
    "language": "en",
    "score": 42,
    "voteCount": 47,
    "confidence": "high",
    "lyrics": "<tt xmlns=\\"http://www.w3.org/ns/ttml\\"> ... </tt>"
  }
}`

const SEARCH_RESPONSE = `{
  "success": true,
  "data": [
    {
      "id": 4821,
      "videoId": "dQw4w9WgXcQ",
      "song": "Never Gonna Give You Up",
      "artist": "Rick Astley",
      "format": "ttml",
      "syncType": "richsync",
      "confidence": "high",
      "matchScore": 0.98
    }
  ]
}`

const ERROR_RESPONSE = `{
  "success": false,
  "error": "Not found",
  "code": "NOT_FOUND",
  "hint": "No lyrics matched that lookup yet."
}`

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-unison-bg-elevated/60 px-1 py-0.5 font-mono text-[0.85em] text-unison-text">
      {children}
    </code>
  )
}

export function DocsPage() {
  return (
    <CodeLangProvider>
      <div className="max-w-2xl space-y-10">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Fetching lyrics from Unison</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            Unison is a public database of community-synced lyrics, the community-fed source Better Lyrics reads from.
            Each entry is keyed on a <Code>videoId</Code>. Reading from it needs no key and no sign-in. The base URL is{" "}
            <Code>{BASE_URL}</Code>. Every <Code>/lyrics</Code> response is wrapped as{" "}
            <Code>{"{ success, data }"}</Code>, so check <Code>success</Code> before you touch <Code>data</Code>. Reads
            are rate limited to 120 requests per minute per IP.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Quickstart</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            If you have a video id, one call gets you the top-ranked lyrics for it. The synced text is in{" "}
            <Code>data.lyrics</Code> and its format is in <Code>data.format</Code>.
          </p>
          <CodeTabs tabs={QUICKSTART_TABS} />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Fetch by video</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            <Code>GET /lyrics?v=&lt;videoId&gt;</Code> returns the single best version for that video. The fields you
            need to render are <Code>lyrics</Code>, <Code>format</Code>, and <Code>syncType</Code>;{" "}
            <Code>confidence</Code> tells you how much the community has vetted it. A miss returns <Code>404</Code>.
          </p>
          <CodeBlock code={VIDEO_RESPONSE} language="json" label="JSON response" />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Fetch by song and artist</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            No video id? Look up by <Code>song</Code> and <Code>artist</Code> instead. Both are matched
            case-insensitively. Add <Code>album</Code> or <Code>duration</Code> (seconds, matched within a small
            tolerance) when a title has more than one recording.
          </p>
          <CodeTabs tabs={fetchTabs(SONG_ARTIST_URL)} />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Search</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            <Code>GET /lyrics/search?q=&lt;text&gt;</Code> is for discovery. It returns ranked candidates with a{" "}
            <Code>matchScore</Code> but no lyric body, so pick the <Code>videoId</Code> you want and fetch it with{" "}
            <Code>/lyrics?v=</Code>. Passing <Code>song</Code> and <Code>artist</Code> instead of <Code>q</Code> runs an
            exact match and does include the full records. Use <Code>limit</Code> to cap results.
          </p>
          <CodeTabs tabs={fetchTabs(SEARCH_URL)} />
          <CodeBlock code={SEARCH_RESPONSE} language="json" label="JSON response" />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Other versions</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            A video can have several submitted versions. <Code>GET /lyrics/variants/:videoId</Code> lists them all,
            best-ranked first (up to 50), so you can offer alternatives if the default is not the one you want.{" "}
            <Code>GET /lyrics/:id</Code> fetches one specific version by its numeric id.
          </p>
          <CodeTabs tabs={fetchTabs(VARIANTS_URL)} />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Formats</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            The <Code>format</Code> field tells you how to read <Code>lyrics</Code>, and <Code>syncType</Code> tells you
            how precise the timing is.
          </p>
          <ul className="space-y-1.5 text-sm leading-relaxed text-unison-text-secondary">
            <li>
              <Code>ttml</Code> is timed XML, the richest format. Pair it with <Code>syncType</Code>{" "}
              <Code>richsync</Code> for word-by-word timing or <Code>linesync</Code> for per-line timing.
            </li>
            <li>
              <Code>lrc</Code> is timestamped lines, the classic karaoke format.
            </li>
            <li>
              <Code>plain</Code> is unsynced text, with <Code>syncType</Code> <Code>plain</Code>.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Errors and limits</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            Failed <Code>/lyrics</Code> calls keep the envelope with <Code>success: false</Code> plus a{" "}
            <Code>code</Code> and a human-readable <Code>error</Code> and <Code>hint</Code>. Common ones are{" "}
            <Code>404</Code> when nothing matches and <Code>400</Code> when the query is missing a required param. Stay
            under 120 requests per minute per IP or you get <Code>429</Code>.
          </p>
          <CodeBlock code={ERROR_RESPONSE} language="json" label="JSON response" />
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-unison-border pt-6 text-xs text-unison-text-muted">
          <div>
            <span className="text-unison-text-secondary">Related projects</span>
            <span className="px-1.5 opacity-60">·</span>
            <a
              href="https://betterlyrics.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-unison-text transition-colors hover:text-unison-text-secondary"
            >
              Better Lyrics
            </a>
            <span className="px-1.5 opacity-60">·</span>
            <a
              href="https://composer.boidu.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-unison-text transition-colors hover:text-unison-text-secondary"
            >
              Composer
            </a>
          </div>
          <a
            href="https://github.com/better-lyrics/unison"
            target="_blank"
            rel="noopener noreferrer"
            className="text-unison-text transition-colors hover:text-unison-text-secondary"
          >
            GitHub
          </a>
        </footer>
      </div>
    </CodeLangProvider>
  )
}
