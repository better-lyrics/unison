import { IconDownload } from "@tabler/icons-react"

interface DownloadButtonProps {
  onClick: () => void
  disabled?: boolean
  className?: string
  iconClassName?: string
  withText?: boolean
}

export function DownloadButton({
  onClick,
  disabled,
  className,
  iconClassName = "size-4",
  withText = false,
}: DownloadButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Download lyrics file"
      title="Download lyrics"
      className={className}
    >
      <IconDownload className={iconClassName} stroke={1.75} />
      {withText ? <span>Download</span> : null}
    </button>
  )
}
