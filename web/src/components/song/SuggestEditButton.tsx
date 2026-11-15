import { type DiffMode, DiffView } from "@/components/DiffView"
import { Kbd } from "@/components/Kbd"
import { NoteField } from "@/components/NoteField"
import { SongThumbnail } from "@/components/SongThumbnail"
import { Tooltip } from "@/components/Tooltip"
import { CouncilOverlay } from "@/components/council/CouncilOverlay"
import { Segmented } from "@/components/council/Segmented"
import { BlockHead } from "@/components/council/detail-parts"
import { Bone } from "@/components/skeleton"
import { WITHDRAW_TITLE, withdrawBody } from "@/components/song/SuggestionChanges"
import {
  buttonClass,
  chipClass,
  chipIconClass,
  glassClass,
  panelClass,
  raisedChipClass,
  sentenceCaseTagClass,
  tagClass,
} from "@/components/ui"
import { useAnimatedHeight } from "@/hooks/useAnimatedHeight"
import { usePresence } from "@/hooks/usePresence"
import { usePreviewSuggestion, useSendSuggestion, useWithdrawSuggestion } from "@/hooks/useSuggestionMutations"
import { useSuggestionViewer } from "@/hooks/useSuggestionViewer"
import { cn } from "@/lib/cn"
import { composerLyricUrl } from "@/lib/composer"
import { reasonBecause } from "@/lib/council-reasons"
import { downloadTextFile } from "@/lib/download"
import { formatElapsed, titleCase } from "@/lib/format"
import { languageName } from "@/lib/language"
import { FORMAT_LABEL, lyricsFilename, MIME_BY_FORMAT } from "@/lib/lyrics-download"
import {
  type SuggestAction,
  type SuggestionDecider,
  lyricsFormatOf,
  ownerWindow,
  suggestAction,
  isOwnerless,
  suggestionDecider,
  suggestionErrorMessage,
} from "@/lib/lyric-suggestion"
import { FIELD_LABEL } from "@/lib/revision-fields"
import type { FieldCheck, PreviewResult, RevisionInput } from "@/lib/revision-types"
import { pushToast } from "@/lib/toast"
import type { VariantFull } from "@/lib/types"
import {
  type Icon,
  IconAlertTriangle,
  IconArrowBackUp,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconDownload,
  IconExternalLink,
  IconFileText,
  IconFileUpload,
  IconInfoCircle,
  IconPencil,
} from "@tabler/icons-react"
import {
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { useSearchParams } from "react-router-dom"

const ACCEPT = ".ttml,.xml,.lrc,.txt"
const NEEDS_LYRIC_TIP = "Add a lyric of your own first. Then you can suggest edits."
const WAITING_TIP = "Another edit is waiting on this lyric. Try again once it is decided."

const ownerName = (variant: VariantFull) => variant.submitter?.displayName ?? "the owner"
const ownerlessLyric = (variant: VariantFull) => isOwnerless(variant.submitter?.keyId)

function UnavailableChip({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip label={tip}>
      <button type="button" aria-disabled="true" className={chipClass}>
        <IconPencil aria-hidden className={chipIconClass} stroke={1.75} />
        {label}
      </button>
    </Tooltip>
  )
}

function useSuggestAction(variant: VariantFull) {
  return suggestAction(useSuggestionViewer(), {
    submitterKeyId: variant.submitter?.keyId ?? null,
    suggestion: variant.revision?.suggestion,
    pending: variant.revision?.pending,
  })
}

function WithdrawChip({
  variant,
  chipRef,
  onWithdrawn,
}: {
  variant: VariantFull
  chipRef: RefObject<HTMLButtonElement | null>
  onWithdrawn: () => void
}) {
  const withdraw = useWithdrawSuggestion(
    { lyricsId: variant.id, videoId: variant.videoId },
    variant.revision?.suggestion?.id,
  )
  const [confirming, setConfirming] = useState(false)
  const fold = usePresence(confirming, "--acc-collapse")
  const panelId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const asked = useRef(false)
  useEffect(() => {
    if (confirming) {
      asked.current = true
      confirmRef.current?.focus()
    } else if (asked.current) {
      chipRef.current?.focus()
    }
  }, [confirming, chipRef])

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        aria-expanded={confirming}
        aria-controls={fold.mounted ? panelId : undefined}
        className={cn(chipClass, "aria-expanded:bg-white/[0.14] aria-expanded:text-unison-text")}
        onClick={() => setConfirming(!confirming)}
      >
        <IconArrowBackUp aria-hidden className={chipIconClass} stroke={1.75} />
        Withdraw suggestion
      </button>
      {fold.mounted ? (
        <div className="t-acc t-acc-enter order-last basis-full" data-open={confirming}>
          <div id={panelId} inert={!confirming} className="t-acc-panel">
            <div className="t-acc-panel-inner">
              <div className={cn(glassClass, "flex max-w-[440px] flex-col gap-3 rounded-[22px] p-3")}>
                <p className="text-[13px] leading-normal text-pretty text-(--ink-2) [text-shadow:none]">
                  <b className="font-semibold text-unison-text">{WITHDRAW_TITLE}</b>{" "}
                  {withdrawBody(ownerlessLyric(variant))}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={chipClass} onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                  <button
                    ref={confirmRef}
                    type="button"
                    disabled={withdraw.isPending}
                    className={cn(raisedChipClass, "disabled:cursor-not-allowed disabled:opacity-60")}
                    onClick={() =>
                      withdraw.mutate(undefined, {
                        onSuccess: () => {
                          onWithdrawn()
                          setConfirming(false)
                        },
                      })
                    }
                  >
                    <IconArrowBackUp aria-hidden className={chipIconClass} stroke={1.75} />
                    Withdraw suggestion
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function SuggestEditButton({ variant }: { variant: VariantFull }) {
  const [open, setOpen] = useState(false)
  const dialog = usePresence(open, "--modal-close-dur")
  const action = useSuggestAction(variant)
  const [params] = useSearchParams()
  const onOwnSuggestion = params.get("suggestion") === String(variant.revision?.suggestion?.id)
  const chipRef = useRef<HTMLButtonElement>(null)
  const focusOn = useRef<SuggestAction | null>(null)
  useEffect(() => {
    if (focusOn.current !== action) return
    focusOn.current = null
    chipRef.current?.focus()
  }, [action])

  return (
    <>
      <SuggestChip
        action={action}
        variant={variant}
        hideWithdraw={onOwnSuggestion}
        chipRef={chipRef}
        onSuggest={() => setOpen(true)}
        onWithdrawn={() => {
          focusOn.current = "suggest"
        }}
      />
      {dialog.mounted ? (
        <SuggestDialog
          variant={variant}
          open={open}
          onClose={() => setOpen(false)}
          onSent={() => {
            focusOn.current = "withdraw"
          }}
        />
      ) : null}
    </>
  )
}

function SuggestChip({
  action,
  variant,
  hideWithdraw,
  chipRef,
  onSuggest,
  onWithdrawn,
}: {
  action: SuggestAction
  variant: VariantFull
  hideWithdraw: boolean
  chipRef: RefObject<HTMLButtonElement | null>
  onSuggest: () => void
  onWithdrawn: () => void
}) {
  switch (action) {
    case "none":
      return null
    case "sign-in":
      return <UnavailableChip label="Suggest an edit" tip="Sign in to suggest an edit" />
    case "needs-lyric":
      return <UnavailableChip label="Suggest an edit" tip={NEEDS_LYRIC_TIP} />
    case "waiting":
      return <UnavailableChip label="Suggest an edit" tip={WAITING_TIP} />
    case "withdraw":
      return hideWithdraw ? null : <WithdrawChip variant={variant} chipRef={chipRef} onWithdrawn={onWithdrawn} />
    case "suggest":
      return (
        <button ref={chipRef} type="button" className={chipClass} onClick={onSuggest}>
          <IconPencil aria-hidden className={chipIconClass} stroke={1.75} />
          Suggest an edit
        </button>
      )
  }
}

export function SuggestionWaitingLine({ variant }: { variant: VariantFull }) {
  const now = Math.floor(Date.now() / 1000)
  const action = useSuggestAction(variant)
  const suggestion = variant.revision?.suggestion
  if (action !== "withdraw" || !suggestion) return null
  const ownerDecides = suggestionDecider({ ...suggestion, ownerless: ownerlessLyric(variant) }) === "owner"
  const waitingOn = !ownerDecides
    ? "Your suggestion is waiting on the council."
    : suggestion.councilDecidesAt === null
      ? `Your suggestion is waiting on ${ownerName(variant)} or the council.`
      : `Your suggestion is waiting on ${ownerName(variant)}.`
  return (
    <p className="mt-3.5 flex items-center gap-2 text-[13px] font-medium text-(--ink-2) max-sm:col-span-2">
      <IconClock aria-hidden className="size-[15px] shrink-0 text-unison-text opacity-50" stroke={1.75} />
      {`${waitingOn} Sent ${formatElapsed(now - suggestion.createdAt)} ago.`}
    </p>
  )
}

const COUNCIL_NOW = "The council decides this one."
export function suggestionSentToast(owner: string, decider: SuggestionDecider, ownerDecisionSec: number) {
  pushToast({
    kind: "success",
    message: "Suggestion sent",
    detail: decider === "owner" ? `${owner} has ${ownerWindow(ownerDecisionSec)} to decide.` : COUNCIL_NOW,
  })
}

export interface SuggestFile {
  input: RevisionInput
  name: string | null
  bytes: number
}

function SuggestDialog({
  variant,
  open,
  onClose,
  onSent,
}: {
  variant: VariantFull
  open: boolean
  onClose: () => void
  onSent: () => void
}) {
  const [file, setFile] = useState<SuggestFile | null>(null)
  const [note, setNote] = useState("")
  const [wentBack, setWentBack] = useState(false)
  const preview = usePreviewSuggestion(variant.id)
  const send = useSendSuggestion({ lyricsId: variant.id, videoId: variant.videoId })

  const check = (text: string, name: string | null) => {
    if (text.trim() === "") return
    const next = { input: { lyrics: text, format: lyricsFormatOf(text) }, name, bytes: new Blob([text]).size }
    setFile(next)
    setWentBack(false)
    send.reset()
    preview.mutate(next.input)
  }
  const startOver = () => {
    setFile(null)
    setWentBack(true)
    preview.reset()
    send.reset()
  }
  const submit = (input: RevisionInput, ownerDecisionSec: number) =>
    send.mutate(
      { input, note },
      {
        onSuccess: ({ revision }) => {
          suggestionSentToast(
            ownerName(variant),
            suggestionDecider({ pendingReason: revision.pendingReason, ownerless: ownerlessLyric(variant) }),
            ownerDecisionSec,
          )
          onSent()
          onClose()
        },
      },
    )

  const checked = preview.data
  if (file && checked) {
    return (
      <SuggestDialogFrame open={open} step={2} phase="preview" onClose={onClose}>
        <PreviewStep
          variant={variant}
          file={file}
          result={checked}
          note={note}
          onNote={setNote}
          sending={send.isPending}
          error={send.isError ? suggestionErrorMessage(send.error) : null}
          onBack={startOver}
          onReplace={check}
          onSend={() => submit(file.input, checked.ownerDecisionSec)}
        />
      </SuggestDialogFrame>
    )
  }
  if (file && preview.isPending) {
    return (
      <SuggestDialogFrame open={open} step={2} phase="checking" onClose={onClose}>
        <CheckingStep onBack={startOver} />
      </SuggestDialogFrame>
    )
  }
  return (
    <SuggestDialogFrame open={open} step={1} onClose={onClose}>
      <PickStep
        variant={variant}
        error={preview.isError ? suggestionErrorMessage(preview.error) : null}
        focusUpload={wentBack}
        onFile={check}
        onCancel={onClose}
      />
    </SuggestDialogFrame>
  )
}

const stepRank = (step: 1 | 2, phase?: string) => (step === 1 ? 0 : phase === "checking" ? 1 : 2)

export function SuggestDialogFrame({
  open,
  step,
  phase,
  onClose,
  children,
}: {
  open: boolean
  step: 1 | 2
  phase?: string
  onClose: () => void
  children: ReactNode
}) {
  const resize = useAnimatedHeight()
  const key = phase ?? String(step)
  const rank = stepRank(step, phase)
  const [shown, setShown] = useState({ key, rank, back: false, moved: false })
  if (shown.key !== key) setShown({ key, rank, back: rank < shown.rank, moved: true })
  return (
    <CouncilOverlay
      open={open}
      onOpenChange={(value) => (value ? null : onClose())}
      label="Suggest an edit"
      className="top-1/2 -translate-y-1/2"
    >
      <div ref={resize} className="t-resize">
        <div className="flex max-h-[calc(100dvh-64px)] flex-col">
          <div className="flex items-center gap-3 px-6 pt-5">
            <h2 className="text-base font-semibold">Suggest an edit</h2>
            <span className="ml-auto text-xs text-unison-text-muted tabular-nums">{`Step ${step} of 2`}</span>
          </div>
          <div
            key={key}
            data-back={shown.back ? "" : undefined}
            className={cn("flex min-h-0 flex-1 flex-col", shown.moved && "t-step")}
          >
            {children}
          </div>
        </div>
      </div>
    </CouncilOverlay>
  )
}

const DIALOG_BODY = "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-6 pt-4 pb-6 outline-none"
const DIALOG_FOOT =
  "flex min-h-[60px] flex-wrap items-center justify-end gap-x-4 gap-y-2 bg-[#141318] px-6 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
const FOOT_HIT = "relative after:absolute after:inset-x-0 after:-inset-y-[5px]"

function DialogFoot({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <div className={DIALOG_FOOT}>
      <span className="min-w-[140px] flex-1 text-pretty text-xs text-unison-text-muted">{hint}</span>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  )
}

function useFocusOnMount<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (enabled) ref.current?.focus()
  }, [enabled])
  return ref
}

function StepHeading({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
      <span className="inline-grid size-[18px] place-items-center rounded-full bg-white/[0.08] font-mono text-[11px] text-unison-text-secondary">
        {n}
      </span>
      {children}
    </h3>
  )
}

function SongMini({ variant }: { variant: VariantFull }) {
  const rev = variant.revision?.revNo ?? 1
  return (
    <div className="flex items-start gap-3">
      <SongThumbnail
        videoId={variant.videoId}
        song={variant.song}
        artist={variant.artist}
        className="size-11 rounded-md"
      />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="line-clamp-2 text-sm leading-snug font-semibold text-pretty">{variant.song}</p>
        <p className="mt-0.5 truncate text-xs text-unison-text-secondary">
          {variant.submitter ? `${variant.artist} · synced by ${variant.submitter.displayName}` : variant.artist}
        </p>
      </div>
      <span
        className={cn(tagClass, sentenceCaseTagClass, "mt-0.5 shrink-0")}
      >{`Rev ${rev} · ${FORMAT_LABEL[variant.format]}`}</span>
    </div>
  )
}

const UNREADABLE = "Could not read that file. Try another one."

function useLyricsFilePicker(onFile: (text: string, name: string | null) => void) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [unreadable, setUnreadable] = useState(false)
  const read = (file: File | undefined) => {
    if (!file) return
    setUnreadable(false)
    file.text().then(
      (text) => onFile(text, file.name),
      () => setUnreadable(true),
    )
  }
  const input = (
    <input
      ref={fileRef}
      type="file"
      accept={ACCEPT}
      aria-label="Fixed lyrics file"
      className="hidden"
      onChange={(e) => {
        read(e.target.files?.[0])
        e.target.value = ""
      }}
    />
  )
  return { input, read, unreadable, choose: () => fileRef.current?.click() }
}

export function PickStep({
  variant,
  error,
  focusUpload = false,
  onFile,
  onCancel,
}: {
  variant: VariantFull
  error: string | null
  focusUpload?: boolean
  onFile: (text: string, name: string | null) => void
  onCancel: () => void
}) {
  const picker = useLyricsFilePicker(onFile)
  const uploadRef = useFocusOnMount<HTMLButtonElement>(focusUpload)
  const [dragging, setDragging] = useState(false)
  const filename = lyricsFilename(variant)
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    picker.read(e.dataTransfer.files[0])
  }
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData.getData("text")
    if (text) {
      e.preventDefault()
      onFile(text, null)
    }
  }

  return (
    <>
      <div className={DIALOG_BODY} onPaste={onPaste}>
        <SongMini variant={variant} />
        <div>
          <StepHeading n={1}>Make the fix</StepHeading>
          <p className="mb-3 text-[13px] leading-normal text-unison-text-secondary">
            Start from the live version, so your fix changes only what needs fixing.
          </p>
          <a
            href={composerLyricUrl(variant.id)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("primary", "md")}
          >
            <IconExternalLink aria-hidden className="size-4" stroke={1.75} />
            Open in Composer
          </a>
          <p className="mt-4 mb-2 text-xs text-unison-text-muted">Using another editor?</p>
          <FileDownloadRow
            filename={filename}
            onClick={() => downloadTextFile(filename, variant.lyrics, MIME_BY_FORMAT[variant.format])}
          />
        </div>
        <div>
          <StepHeading n={2}>Upload the fixed file</StepHeading>
          <button
            ref={uploadRef}
            type="button"
            onClick={picker.choose}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-dragging={dragging || undefined}
            className="group flex w-full cursor-pointer flex-col items-center gap-2 rounded-[10px] bg-white/[0.02] px-6 py-6 text-center transition-[background-color,box-shadow,scale] duration-150 ease-out hover:bg-unison-bg-hover active:scale-[0.96] data-dragging:bg-council-edit/10 data-dragging:shadow-[inset_0_0_0_1px_rgba(111,122,240,0.24)] [&>*]:pointer-events-none"
          >
            <IconFileUpload
              aria-hidden
              className="size-5 text-unison-text opacity-50 transition-opacity duration-150 group-hover:opacity-100 group-data-dragging:opacity-100"
              stroke={1.5}
            />
            <span className="text-[13px] text-unison-text-secondary">
              Drop a .ttml, .lrc or .txt file here, or choose one
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-unison-text-muted">
              Or paste it with <Kbd keys={["Mod", "V"]} />
            </span>
          </button>
          {picker.input}
          {picker.unreadable || error ? (
            <p role="alert" className="mt-2 text-xs text-[#fca5a5]">
              {picker.unreadable ? UNREADABLE : error}
            </p>
          ) : null}
        </div>
      </div>
      <DialogFoot>
        <button type="button" className={cn(buttonClass("fill", "sm"), FOOT_HIT)} onClick={onCancel}>
          Cancel
        </button>
      </DialogFoot>
    </>
  )
}

function FileDownloadRow({ filename, onClick }: { filename: string; onClick: () => void }) {
  const dot = filename.lastIndexOf(".")
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot) : ""
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Download ${filename}`}
      className="flex min-h-10 w-fit max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl bg-white/[0.04] pr-3.5 pl-3 text-left text-[13px] transition-[background-color,scale] duration-150 ease-out hover:bg-white/[0.08] active:scale-[0.96]"
    >
      <IconDownload aria-hidden className="size-4 shrink-0 text-unison-text opacity-50" stroke={1.75} />
      <span className="shrink-0 font-medium">Download</span>
      <span className="flex min-w-0 text-unison-text-secondary">
        <span className="truncate">{stem}</span>
        <span className="shrink-0">{extension}</span>
      </span>
    </button>
  )
}

function CheckingStep({ onBack }: { onBack: () => void }) {
  const backRef = useFocusOnMount<HTMLButtonElement>()
  return (
    <>
      <div aria-busy="true" className={DIALOG_BODY}>
        <p className="text-xs text-unison-text-muted">Checking the file</p>
        <Bone className="h-40 w-full rounded-[10px]" />
      </div>
      <DialogFoot>
        <button ref={backRef} type="button" className={cn(buttonClass("fill", "sm"), FOOT_HIT)} onClick={onBack}>
          Back
        </button>
        <button type="button" disabled className={cn(buttonClass("primary", "sm"), FOOT_HIT)}>
          Send suggestion
        </button>
      </DialogFoot>
    </>
  )
}

const CHECK_ICON: Record<FieldCheck["status"], { icon: Icon; className: string }> = {
  ok: { icon: IconCircleCheck, className: "text-unison-text-secondary opacity-70" },
  warn: { icon: IconAlertTriangle, className: "text-unison-warn" },
  bad: { icon: IconCircleX, className: "text-[#fca5a5]" },
}

function checkMessage(check: FieldCheck): string {
  if (check.language === undefined) return check.message
  if (check.detectedLanguage !== undefined) {
    return `The lyrics look like ${languageName(check.detectedLanguage)}, not ${languageName(check.language)}.`
  }
  return `Language: ${languageName(check.language)}.`
}

function checkValue(check: FieldCheck): string {
  const message = checkMessage(check)
  const labelled = `${FIELD_LABEL[check.field]}: `
  if (!message.startsWith(labelled)) return message
  const value = message.slice(labelled.length)
  return value.endsWith(".") ? value.slice(0, -1) : value
}

function previewBlocker(result: PreviewResult): string | null {
  if (result.noChanges) return "This file matches the live version. Change something, then upload it again."
  if (result.checks.some((c) => c.status === "bad")) return "Fix the problems above, then upload the file again."
  if (result.rateLimit.lyricRemaining === 0) {
    return "You have sent today's suggestions for this lyric. Try again tomorrow."
  }
  if (result.rateLimit.userRemaining === 0) {
    return "You have reached today's edit limit for your account. Try again tomorrow."
  }
  return null
}

function whoDecides(result: PreviewResult, owner: string, ownerless: boolean): string {
  const reason = result.outcome.reason
  if (suggestionDecider({ pendingReason: reason, ownerless }) === "owner") return `${owner}, the owner.`
  if (reason === null || reason === "suggested") return "The council, because this lyric has no owner."
  return `The council, because ${reasonBecause(reason)}.`
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

const CHECK_ROW = "grid grid-cols-[16px_88px_minmax(0,1fr)] items-start gap-2.5 px-3.5 py-2.5 text-[13px]"

export function PreviewStep({
  variant,
  file,
  result,
  note,
  onNote,
  sending,
  error,
  onBack,
  onReplace,
  onSend,
}: {
  variant: VariantFull
  file: SuggestFile
  result: PreviewResult
  note: string
  onNote: (note: string) => void
  sending: boolean
  error: string | null
  onBack: () => void
  onReplace: (text: string, name: string | null) => void
  onSend: () => void
}) {
  const [mode, setMode] = useState<DiffMode>("unified")
  const picker = useLyricsFilePicker(onReplace)
  const noteId = useId()
  const owner = ownerName(variant)
  const ownerless = ownerlessLyric(variant)
  const ownerDecides = suggestionDecider({ pendingReason: result.outcome.reason, ownerless }) === "owner"
  const reader = ownerDecides ? owner : "the council"
  const blocker = previewBlocker(result)
  const sendRef = useFocusOnMount<HTMLButtonElement>(blocker === null)
  const replaceRef = useFocusOnMount<HTMLButtonElement>(blocker !== null)
  return (
    <>
      <div className={DIALOG_BODY}>
        <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] py-1.5 pr-1.5 pl-3 text-[13px]">
          <IconFileText aria-hidden className="size-4 shrink-0 text-unison-text opacity-50" stroke={1.75} />
          <span className="min-w-0 truncate">{file.name ?? "Pasted lyrics"}</span>
          <span className="shrink-0 text-xs text-unison-text-muted tabular-nums">{formatBytes(file.bytes)}</span>
          <button
            ref={replaceRef}
            type="button"
            className={cn(buttonClass("ghost", "sm"), "ml-auto")}
            onClick={picker.choose}
          >
            Replace
          </button>
          {picker.input}
        </div>
        {picker.unreadable ? (
          <p role="alert" className="-mt-4 text-xs text-[#fca5a5]">
            {UNREADABLE}
          </p>
        ) : null}
        <div>
          <BlockHead title="Checks" />
          <ul className={cn(panelClass, "rounded-[10px] divide-y divide-white/[0.03]")}>
            {result.checks.map((check) => {
              const { icon: CheckIcon, className } = CHECK_ICON[check.status]
              return (
                <li key={`${check.field}-${check.message}`} className={CHECK_ROW}>
                  <CheckIcon aria-hidden className={cn("mt-0.5 size-4", className)} stroke={1.75} />
                  <span className="text-unison-text-muted">{FIELD_LABEL[check.field]}</span>
                  <span className="text-unison-text-secondary">
                    {checkValue(check)}
                    {check.line === undefined ? null : (
                      <span className="mt-1 block font-mono text-xs text-unison-text-muted">{`Line ${check.line}`}</span>
                    )}
                  </span>
                </li>
              )
            })}
            {blocker ? null : (
              <li className={CHECK_ROW}>
                <IconInfoCircle aria-hidden className="mt-0.5 size-4 text-council-edit-ink" stroke={1.75} />
                <span className="text-unison-text-muted">Who decides</span>
                <span className="text-unison-text-secondary">{whoDecides(result, owner, ownerless)}</span>
              </li>
            )}
          </ul>
        </div>
        {result.noChanges || result.checks.some((c) => c.status === "bad") ? null : (
          <>
            <div>
              <BlockHead
                title="Changes"
                aside={
                  <Segmented
                    label="Diff layout"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "unified", label: "Unified" },
                      { value: "split", label: "Split" },
                    ]}
                  />
                }
              />
              <DiffView rows={result.diff.rows} mode={mode} />
            </div>
            <div className="flex flex-col gap-1">
              <NoteField
                id={noteId}
                label={`Note for ${reader} (optional)`}
                max={result.noteMaxLength}
                value={note}
                onChange={onNote}
                rows={2}
              />
              <p className="mt-1 text-xs text-unison-text-muted">
                {`Say what you fixed and where. ${titleCase(reader)} sees this note with your suggestion.`}
              </p>
            </div>
          </>
        )}
        {error ? (
          <p role="alert" className="text-xs text-[#fca5a5]">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFoot
        hint={
          blocker ??
          (ownerDecides
            ? `${owner} has ${ownerWindow(result.ownerDecisionSec)} to decide. After that, the council can too.`
            : COUNCIL_NOW)
        }
      >
        <button type="button" className={cn(buttonClass("fill", "sm"), FOOT_HIT)} onClick={onBack}>
          Back
        </button>
        <button
          ref={sendRef}
          type="button"
          disabled={blocker !== null || sending}
          className={cn(buttonClass("primary", "sm"), FOOT_HIT)}
          onClick={onSend}
        >
          Send suggestion
        </button>
      </DialogFoot>
    </>
  )
}
