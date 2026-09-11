import { cn } from "@/lib/cn"
import type { ScenarioComposer, ScenarioEmbed, ScenarioMessage, ScenarioSurface } from "@/lib/examApi"
import { Fragment } from "react"
import { HoldToConfirm } from "./HoldToConfirm"
import "./discord-sim.css"

// Splits message text into its inline runs: the {{candidate}} placeholder, a
// <@Role> role mention, an @mention, a :shortcode: emoji, or plain text.
const TOKEN = /(\{\{candidate\}\}|<@[\w ]+>|@[\w.]+|:[a-z0-9_]+:)/gi

// Role mentions render in the role's own colour, the way Discord does. Authored as
// <@RoleName> so they stay distinct from a plain @user mention.
const ROLE_COLORS: Record<string, string> = {
  Moderator: "#e2c648",
}

// Local, first-party emoji served from web/public/emoji. Discord renders custom
// emoji from a :shortcode:; an unknown one stays literal text, same as Discord.
const EMOJI: Record<string, string> = {
  thumbsupcat: "/emoji/thumbsupcat.png",
  pogfishanimated: "/emoji/pogfishanimated.gif",
  homeless: "/emoji/homeless.png",
  wspeed: "/emoji/wspeed.png",
  "1984": "/emoji/1984.png",
}

// Stable keys for statically-derived lists (split runs, lyric lines, a message
// thread) without leaning on the array index: identical values get a running suffix
// so duplicates stay distinct.
function keyer() {
  const seen = new Map<string, number>()
  return (value: string) => {
    const n = (seen.get(value) ?? 0) + 1
    seen.set(value, n)
    return `${value}#${n}`
  }
}

function renderText(text: string, candidateName?: string) {
  const key = keyer()
  return text.split(TOKEN).map((part) => {
    if (part === "{{candidate}}") {
      return (
        <span key={key(part)} className="ds-mention">
          @{candidateName?.trim() || "you"}
        </span>
      )
    }
    const role = /^<@([\w ]+)>$/.exec(part)
    if (role) {
      const name = role[1]
      const color = ROLE_COLORS[name]
      return (
        <span
          key={key(part)}
          className="ds-mention"
          style={color ? { color, backgroundColor: `${color}28` } : undefined}
        >
          @{name}
        </span>
      )
    }
    if (/^@[\w.]+$/.test(part)) {
      return (
        <span key={key(part)} className="ds-mention">
          {part}
        </span>
      )
    }
    const src = part.length > 2 && part.startsWith(":") && part.endsWith(":") ? EMOJI[part.slice(1, -1).toLowerCase()] : undefined
    if (src) {
      return <img key={key(part)} className="ds-emoji" src={src} alt={part} />
    }
    return <Fragment key={key(part)}>{part}</Fragment>
  })
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function ReturnGlyph() {
  return (
    <svg className="ds-return" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14 3.5v3C14 7.879 12.879 9 11.5 9H3.707l2.646 2.646a.5.5 0 0 1-.708.707l-3.5-3.5a.5.5 0 0 1 0-.707l3.5-3.5a.5.5 0 0 1 .707.707L3.706 7.999h7.793c.827 0 1.5-.673 1.5-1.5v-3a.5.5 0 0 1 1 0z"
      />
    </svg>
  )
}

function Embed({ embed }: { embed: ScenarioEmbed }) {
  const lineKey = keyer()
  return (
    <div className="ds-embed">
      {embed.title ? <div className="ds-embed-title">{embed.title}</div> : null}
      {embed.description ? <div className="ds-embed-desc">{embed.description}</div> : null}
      {embed.fields && embed.fields.length > 0 ? (
        <div className="ds-embed-fields">
          {embed.fields.map((f) => (
            <div key={f.name}>
              <div className="ds-field-name">{f.name}</div>
              <div className="ds-field-val">{f.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {embed.preview && embed.preview.length > 0 ? (
        <div className="ds-preview">
          <div className="ds-thumb">
            <PlayGlyph />
          </div>
          <div>
            {embed.preview.map((line) => (
              <div key={lineKey(line.text)} className={line.dim ? "ds-preview-line ds-dim" : "ds-preview-line"}>
                {line.text}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {embed.footer ? <div className="ds-embed-foot">{embed.footer}</div> : null}
    </div>
  )
}

function Message({ message, candidateName }: { message: ScenarioMessage; candidateName?: string }) {
  return (
    <div className="ds-msg">
      <img className="ds-avatar" src={message.avatar} alt="" />
      <div className="ds-body" style={{ flex: 1 }}>
        <div className="ds-msg-head">
          <span className={message.self ? "ds-name ds-role" : "ds-name"}>{message.author}</span>
          {message.bot ? <span className="ds-bot">Bot</span> : null}
          {message.timestamp ? <span className="ds-ts">{message.timestamp}</span> : null}
        </div>
        {message.text ? <div className="ds-text">{renderText(message.text, candidateName)}</div> : null}
        {message.embed ? <Embed embed={message.embed} /> : null}
      </div>
    </div>
  )
}

function OneShotComposer({
  surfaceId,
  composer,
  value,
  onChange,
  candidateName,
}: {
  surfaceId: string
  composer: ScenarioComposer
  value?: string
  onChange: (optionId: string) => void
  candidateName?: string
}) {
  const chosen = value !== undefined
  const labelId = composer.label ? `${surfaceId}-label` : undefined
  return (
    <div className="ds-composer">
      {composer.label ? (
        <p className="ds-composer-label" id={labelId}>
          {composer.label}
        </p>
      ) : null}
      <fieldset className="ds-holds" aria-labelledby={labelId} aria-label={labelId ? undefined : "Your reply"}>
        {composer.choices.map((choice) => {
          const selected = value === choice.id
          const tone = `ds-action-${choice.intent ?? "secondary"}`
          if (chosen) {
            return (
              <div
                key={choice.id}
                className={cn("ds-hold ds-hold-locked", tone, selected ? "ds-sel" : "ds-dim")}
                aria-hidden={!selected}
              >
                <span className="ds-hold-label">{renderText(choice.label, candidateName)}</span>
              </div>
            )
          }
          return (
            <HoldToConfirm key={choice.id} className={tone} onConfirm={() => onChange(choice.id)}>
              {renderText(choice.label, candidateName)}
            </HoldToConfirm>
          )
        })}
      </fieldset>
      {chosen ? null : <p className="ds-hold-hint">Press and hold to commit. This choice is final.</p>}
    </div>
  )
}

function Composer({
  surfaceId,
  composer,
  value,
  onChange,
  candidateName,
  oneShot,
}: {
  surfaceId: string
  composer: ScenarioComposer
  value?: string
  onChange: (optionId: string) => void
  candidateName?: string
  oneShot?: boolean
}) {
  const isAction = composer.style === "action"
  const chosen = value !== undefined
  const labelId = composer.label ? `${surfaceId}-label` : undefined
  if (oneShot) {
    return (
      <OneShotComposer
        surfaceId={surfaceId}
        composer={composer}
        value={value}
        onChange={onChange}
        candidateName={candidateName}
      />
    )
  }
  return (
    <div className="ds-composer">
      {composer.label ? (
        <p className="ds-composer-label" id={labelId}>
          {composer.label}
        </p>
      ) : null}
      <div
        className={isAction ? "ds-actions" : undefined}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-label={labelId ? undefined : "Your reply"}
      >
        {composer.choices.map((choice) => {
          const selected = value === choice.id
          if (isAction) {
            return (
              <label
                key={choice.id}
                className={cn(
                  "ds-action",
                  `ds-action-${choice.intent ?? "secondary"}`,
                  selected && "ds-sel",
                  chosen && !selected && "ds-dim",
                )}
              >
                <input
                  type="radio"
                  name={surfaceId}
                  value={choice.id}
                  checked={selected}
                  onChange={() => onChange(choice.id)}
                  aria-label={choice.label}
                  className="ds-sr-only"
                />
                <span>{renderText(choice.label, candidateName)}</span>
              </label>
            )
          }
          return (
            <label key={choice.id} className={selected ? "ds-reply ds-sel" : "ds-reply"}>
              <input
                type="radio"
                name={surfaceId}
                value={choice.id}
                checked={selected}
                onChange={() => onChange(choice.id)}
                aria-label={choice.label}
                className="ds-sr-only"
              />
              <span>{renderText(choice.label, candidateName)}</span>
              <span className="ds-send" aria-hidden="true">
                <ReturnGlyph /> send
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function Surface({
  surface,
  value,
  onChange,
  candidateName,
  oneShot,
}: {
  surface: ScenarioSurface
  value?: string
  onChange: (optionId: string) => void
  candidateName?: string
  oneShot?: boolean
}) {
  const msgKey = keyer()
  return (
    <div className="ds-client">
      <div className="ds-head">
        {surface.kind === "dm" ? (
          <span className="ds-at" aria-hidden="true">
            @
          </span>
        ) : (
          <span className="ds-hash" aria-hidden="true">
            #
          </span>
        )}
        <span className="ds-title">{surface.title}</span>
        {surface.subtitle ? <span className="ds-sub">{surface.subtitle}</span> : null}
      </div>
      <div className="ds-thread">
        {surface.messages.map((message) => (
          <Message
            key={msgKey(`${message.author}|${message.text ?? message.embed?.title ?? ""}`)}
            message={message}
            candidateName={candidateName}
          />
        ))}
      </div>
      {surface.composer ? (
        <Composer
          surfaceId={surface.id}
          composer={surface.composer}
          value={value}
          onChange={onChange}
          candidateName={candidateName}
          oneShot={oneShot}
        />
      ) : null}
    </div>
  )
}

// Progressive disclosure: reveal surfaces in order up to the next actionable beat.
// A terminated one-shot scenario stops there: the next beat is never revealed, so the
// story ends on the beat the candidate got wrong.
function visibleSurfaces(surfaces: ScenarioSurface[], answer: Record<string, string>, terminated: boolean) {
  const out: ScenarioSurface[] = []
  for (const surface of surfaces) {
    if (surface.composer && answer[surface.id] === undefined) {
      if (!terminated) out.push(surface)
      break
    }
    out.push(surface)
  }
  return out
}

export function DiscordScenario({
  surfaces,
  answer,
  onChange,
  candidateName,
  oneShot = false,
  terminated = false,
}: {
  surfaces: ScenarioSurface[]
  answer: Record<string, string>
  onChange: (surfaceId: string, optionId: string) => void
  candidateName?: string
  oneShot?: boolean
  terminated?: boolean
}) {
  return (
    <div className="ds-root">
      {oneShot ? (
        <div className="ds-oneshot-warn" role="note">
          <strong className="ds-oneshot-title">You are a Council member!</strong>
          <span className="ds-oneshot-sub">
            This is high stakes stuff. Pay close attention. Whatever option you pick is FINAL. Hold to lock in a
            response. Good luck ❤️
          </span>
        </div>
      ) : null}
      {visibleSurfaces(surfaces, answer, terminated).map((surface) => (
        <Surface
          key={surface.id}
          surface={surface}
          value={answer[surface.id]}
          onChange={(optionId) => onChange(surface.id, optionId)}
          candidateName={candidateName}
          oneShot={oneShot}
        />
      ))}
    </div>
  )
}
