import { Highlight, type Language, themes } from "prism-react-renderer"
import type { LyricsFormat } from "@/lib/types"

interface RawLyricsViewProps {
  body: string
  format: LyricsFormat
}

const LANGUAGE_BY_FORMAT: Record<LyricsFormat, Language> = {
  ttml: "markup",
  lrc: "markup",
  plain: "markup",
}

export function RawLyricsView({ body, format }: RawLyricsViewProps) {
  const language = LANGUAGE_BY_FORMAT[format]

  return (
    <div className="h-[420px] overflow-auto rounded-md">
      <Highlight theme={themes.nightOwl} code={body} language={language}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className="m-0 min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs"
            style={{ ...style, background: "transparent", backgroundColor: "transparent" }}
          >
            {tokens.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable line indices
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable token indices
                  <span key={j} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  )
}
