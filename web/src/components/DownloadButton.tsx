import { IconDownload } from "@tabler/icons-react"

interface DownloadButtonProps {
  onClick: () => void
  disabled?: boolean
  className?: string
  iconClassName?: string
  withText?: boolean
  label?: string
}

export function DownloadButton({
  onClick,
  disabled,
  className,
  iconClassName = "size-4",
  withText = false,
  label,
}: DownloadButtonProps) {
  const name = label ?? "Download lyrics file"
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={name} title={name} className={className}>
      <IconDownload aria-hidden className={iconClassName} stroke={1.75} />
      {withText ? <span className="truncate">{label ?? "Download"}</span> : null}
    </button>
  )
}
