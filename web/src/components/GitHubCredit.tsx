export function GitHubCredit({ login, name, href }: { login: string; name: string; href?: string }) {
  return (
    <a
      href={href ?? `https://github.com/${login}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-unison-text transition-colors hover:text-unison-text-secondary"
    >
      <img
        src={`https://github.com/${login}.png?size=48`}
        alt=""
        className="mr-1.5 inline-block size-5 rounded-full object-cover align-[-0.3em] ring-1 ring-white/10"
      />
      {name}
    </a>
  )
}
