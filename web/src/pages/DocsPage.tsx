import { CodeBlock, CodeLangProvider, type CodeTab, CodeTabs } from "@/components/CodeBlock"
import { COMPOSER_URL } from "@/lib/composer"
import type { ReactNode } from "react"

const BASE_URL = "https://unison.betterlyrics.org"

const VIDEO_URL = `${BASE_URL}/lyrics?v=Ugr4KKK_SqY`
const SONG_ARTIST_URL = `${BASE_URL}/lyrics?song=Explorer&artist=Justice`
const ISRC_URL = `${BASE_URL}/lyrics?isrc=FR8EU2300090`
const PROVIDER_ID_URL = `${BASE_URL}/lyrics?apple_music=1724935872`
const SEARCH_URL = `${BASE_URL}/lyrics/search?q=explorer+justice`
const VARIANTS_URL = `${BASE_URL}/lyrics/variants/Ugr4KKK_SqY?limit=5`

const CACHE_CODE = `const saved = store.get(videoId) // { etag, data } from an earlier call
const res = await fetch("${VIDEO_URL}", {
  headers: saved ? { "If-None-Match": saved.etag } : {},
})

if (res.status === 304) {
  render(saved.data.lyrics, saved.data.format)
} else {
  const { success, data } = await res.json()
  if (success) {
    store.set(videoId, { etag: res.headers.get("ETag"), data })
    render(data.lyrics, data.format)
  }
}`

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

res = requests.get("${BASE_URL}/lyrics", params={"v": "Ugr4KKK_SqY"})
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
    "id": 13529,
    "videoId": "Ugr4KKK_SqY",
    "song": "Explorer",
    "artist": "Justice, Connan Mockasin",
    "album": "Hyperdrama",
    "isrc": "FR8EU2300090",
    "format": "ttml",
    "syncType": "richsync",
    "language": "en",
    "score": 42,
    "voteCount": 47,
    "confidence": "high",
    "lyrics": "<tt xmlns=\\"http://www.w3.org/ns/ttml\\"> ... </tt>"
  }
}`

const PROVIDER_ID_RESPONSE = `{
  "success": true,
  "data": {
    "id": 13529,
    "videoId": "Ugr4KKK_SqY",
    "song": "Explorer",
    "artist": "Justice, Connan Mockasin",
    "isrc": "FR8EU2300090",
    "format": "ttml",
    "syncType": "richsync",
    "language": "en",
    "score": 42,
    "voteCount": 47,
    "confidence": "high",
    "matchedBy": "isrc",
    "lyrics": "<tt xmlns=\\"http://www.w3.org/ns/ttml\\"> ... </tt>"
  }
}`

const LOOKUP_PENDING_RESPONSE = `{
  "success": false,
  "error": "Lookup pending",
  "code": "LOOKUP_PENDING",
  "hint": "We're still matching this track. Try again in a few seconds."
}`

const SEARCH_RESPONSE = `{
  "success": true,
  "data": [
    {
      "id": 13529,
      "videoId": "Ugr4KKK_SqY",
      "song": "Explorer",
      "artist": "Justice, Connan Mockasin",
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
            are rate limited to 600 requests per minute per IP.
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
          <h2 className="text-lg font-semibold text-unison-text">Attribution</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            Any app that shows Unison lyrics must credit Unison and the person who submitted them. The credit can sit at
            the end of the lyrics; it does not have to stay on screen. Apps integrating Unison have until{" "}
            <strong className="text-unison-text">7 February 2027</strong> to add it.
          </p>
          <h3 className="text-sm font-semibold text-unison-text">If you use the API</h3>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            Show <Code>Lyrics from Unison</Code>, linked to{" "}
            <Code>https://unison.betterlyrics.org/song/&lt;videoId&gt;</Code>, and the submitter's{" "}
            <Code>submitter.displayName</Code>, linked to{" "}
            <Code>https://unison.betterlyrics.org/curator/&lt;submitter.keyId&gt;</Code>. Every lyric response carries
            both.
          </p>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            After the deadline, apps that don't show the credit may lose access to the API.
          </p>
          <h3 className="text-sm font-semibold text-unison-text">If you use the database dump</h3>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            The{" "}
            <a
              href="https://github.com/better-lyrics/unison#database-dump"
              target="_blank"
              rel="noopener noreferrer"
              className="text-unison-text transition-colors hover:text-unison-text-secondary"
            >
              dump
            </a>{" "}
            license (ODbL) requires the Unison credit. The submitter credit is our request rather than a license term.
            Each lyric's <Code>submitter_key_id</Code> matches a row in <Code>contributors</Code>, which has the
            submitter's <Code>display_name</Code> and <Code>profile_url</Code>. The lyric's <Code>url</Code> column
            links to its page on Unison.
          </p>
          <h3 className="text-sm font-semibold text-unison-text">Good examples</h3>
          <ul className="space-y-1.5 text-sm leading-relaxed text-unison-text-secondary">
            <li>
              Under the last line: <strong className="text-unison-text">Lyrics from Unison · submitted by boidu</strong>
              , with both parts linked.
            </li>
            <li>In an always visible spot next to the lyrics, or in a footer or credits row that opens with them.</li>
          </ul>
          <h3 className="text-sm font-semibold text-unison-text">Bad examples</h3>
          <ul className="space-y-1.5 text-sm leading-relaxed text-unison-text-secondary">
            <li>No credit at all.</li>
            <li>"Unison" with no link.</li>
            <li>Unison credited, but the submitter left out.</li>
            <li>The credit only on an About or settings page.</li>
            <li>Unison lyrics labelled as another provider's.</li>
          </ul>
          <h3 className="text-sm font-semibold text-unison-text">Why?</h3>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            Every lyric on Unison was submitted by someone in the community, for free. Seeing their name next to their
            work is how they get thanked, and it helps bring in the next contributor. The link matters as much as the
            name: a listener who spots a wrong line follows it to the song page to vote, report or submit a fix, so the
            lyrics in your app get better over time.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Fetch by video</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            <Code>GET /lyrics?v=&lt;videoId&gt;</Code> returns the single best version for that video. The fields you
            need to render are <Code>lyrics</Code>, <Code>format</Code>, and <Code>syncType</Code>;{" "}
            <Code>confidence</Code> tells you how much the community has vetted it. A miss returns <Code>404</Code>.
          </p>
          <CodeTabs tabs={fetchTabs(VIDEO_URL)} />
          <CodeBlock code={VIDEO_RESPONSE} language="json" label="JSON response" />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Fetch by song and artist</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            No video id? Look up by <Code>song</Code> and <Code>artist</Code> instead. Both are matched
            case-insensitively, and <Code>artist</Code> only has to share one credited name, so sending just the main
            artist works for a song with several. Add <Code>album</Code> or <Code>duration</Code> (seconds, matched
            within a small tolerance) when a title has more than one recording.
          </p>
          <CodeTabs tabs={fetchTabs(SONG_ARTIST_URL)} />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Fetch by ISRC</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            <Code>GET /lyrics?isrc=&lt;isrc&gt;</Code> returns the best version for a recording. Case and hyphens do not
            matter. Pass <Code>song</Code> and <Code>artist</Code> too and an unknown ISRC falls back to them.
          </p>
          <CodeTabs tabs={fetchTabs(ISRC_URL)} />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-unison-text">Fetch by Spotify, Apple Music or Tidal id</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            <Code>spotify</Code>, <Code>apple_music</Code> and <Code>tidal</Code> take a track id, not a link. Unison
            turns it into an ISRC with{" "}
            <a
              href="https://link.binimum.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-unison-text transition-colors hover:text-unison-text-secondary"
            >
              BiniLink
            </a>{" "}
            and looks that up. <Code>matchedBy</Code> in the response says how it matched. A <Code>linked_video</Code>{" "}
            match can be a different release, so its timing may drift.
          </p>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            A lookup with a new id can return <Code>503</Code> with <Code>Retry-After</Code> while BiniLink is still
            matching it or is down. Retry a few times, then give up.
          </p>
          <CodeTabs tabs={fetchTabs(PROVIDER_ID_URL)} />
          <CodeBlock code={PROVIDER_ID_RESPONSE} language="json" label="JSON response" />
          <CodeBlock code={LOOKUP_PENDING_RESPONSE} language="json" label="503 response" />
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
          <h2 className="text-lg font-semibold text-unison-text">Caching</h2>
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            Keep the lyrics you fetch and check them before you download them again. A check is cheaper than a full
            download for both Unison and your app, and your copy stays in sync with edits and new versions. Every{" "}
            <Code>GET /lyrics</Code> lookup sends an <Code>ETag</Code>. Save it with the lyric and send it back as{" "}
            <Code>If-None-Match</Code>. If the lyric is the same, you get <Code>304</Code> with no body and use the copy
            you have.
          </p>
          <CodeBlock code={CACHE_CODE} language="javascript" label="JavaScript" />
          <p className="text-sm leading-relaxed text-unison-text-secondary">
            The tag changes when someone edits the lyric or its song details, when the submitter changes their name, or
            when another version moves to the top. Votes and confidence can change under the same tag.
          </p>
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
              <Code>richsync</Code> for syllable-level timing or <Code>linesync</Code> for per-line timing.
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
            under 600 requests per minute per IP or you get <Code>429</Code>.
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
              href={COMPOSER_URL}
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
