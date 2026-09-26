import { useSession } from "@/auth/useSession";
import { UserAvatar } from "@/components/UserAvatar";
import { IconCheck, IconCopy, IconFileUpload, IconLogout, IconUser } from "@tabler/icons-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export function SignInControl() {
  const session = useSession();
  const menu = session.status === "signed-in" ? "account" : "sign-in";
  const [openMenu, setOpenMenu] = useState<"account" | "sign-in" | null>(null);
  const open = openMenu === menu;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) =>
    setOpenMenu((current) => {
      const value = typeof next === "function" ? next(current === menu) : next;
      return value ? menu : null;
    });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (session.status === "loading") {
    return (
      <div
        data-state="loading"
        className="h-8 w-24 animate-pulse rounded-md bg-unison-bg-elevated"
      />
    );
  }

  if (session.status === "signed-in") {
    const { identity } = session;
    const copyKey = async () => {
      await navigator.clipboard.writeText(identity.keyId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };
    const signOut = () => {
      setOpen(false);
      session.signOut();
    };
    return (
      <div className="relative" ref={wrapperRef} data-state="signed-in">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={identity.displayName}
          className="flex cursor-pointer items-center gap-2 rounded-full p-1 pr-3 transition-colors hover:bg-unison-bg-hover"
        >
          <UserAvatar
            avatarUrl={identity.avatarUrl}
            keyId={identity.keyId}
            className="size-7 rounded-full border border-unison-border bg-unison-bg-hover"
          />
          <span className="hidden text-sm font-medium text-unison-text sm:inline">
            {identity.displayName}
          </span>
        </button>
        {open ? (
          <div
            role="menu"
            data-state="open"
            className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-unison-border bg-unison-bg-elevated p-3 shadow-lg"
          >
            <div className="space-y-2 pb-3">
              <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">
                Key ID
              </p>
              <div className="flex items-center gap-2">
                <code
                  title={identity.keyId}
                  className="min-w-0 flex-1 font-mono text-xs text-unison-text"
                >
                  {`${identity.keyId.slice(0, 6)}…${identity.keyId.slice(-6)}`}
                </code>
                <button
                  type="button"
                  onClick={copyKey}
                  aria-label={copied ? "Copied" : "Copy key id"}
                  className="group cursor-pointer shrink-0 rounded-md p-1 text-unison-text transition-colors hover:bg-unison-bg-hover"
                >
                  {copied ? (
                    <IconCheck className="size-4 opacity-50 transition-opacity group-hover:opacity-100" stroke={1.5} />
                  ) : (
                    <IconCopy className="size-4 opacity-50 transition-opacity group-hover:opacity-100" stroke={1.5} />
                  )}
                </button>
              </div>
            </div>
            <div className="border-t border-unison-border pt-2">
              <Link
                to="/me"
                onClick={() => setOpen(false)}
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-unison-text transition-colors hover:bg-unison-bg-hover"
              >
                <IconUser className="size-4" stroke={1.5} />
                View stats
              </Link>
              <button
                type="button"
                onClick={signOut}
                role="menuitem"
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-unison-text transition-colors hover:bg-unison-bg-hover"
              >
                <IconLogout className="size-4" stroke={1.5} />
                Sign out
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!session.extensionAvailable) {
    const onIdentityFile = (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) void session.signInWithFile(file);
    };
    return (
      <div className="relative" ref={wrapperRef} data-state="no-extension">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="cursor-pointer rounded-md bg-unison-bg-elevated px-3 py-1.5 text-sm font-medium text-unison-text transition-colors hover:bg-unison-bg-hover"
        >
          Sign in
        </button>
        {open ? (
          <div
            role="menu"
            data-state="open"
            className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-unison-border bg-unison-bg-elevated p-3 shadow-lg"
          >
            <div className="space-y-2 pb-3">
              <button
                type="button"
                role="menuitem"
                onClick={() => fileInputRef.current?.click()}
                disabled={session.signingIn}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-unison-text transition-colors hover:bg-unison-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconFileUpload className="size-4" stroke={1.5} />
                {session.signingIn ? "Signing in..." : "Upload identity file"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                aria-label="Identity file"
                className="hidden"
                onChange={onIdentityFile}
              />
              <p className="px-2 text-xs leading-relaxed text-unison-text-muted">
                Export it in Better Lyrics options → Identity → Export Key. Only upload it on this site, it is the key
                to your account.
              </p>
              {session.status === "error" ? (
                <p role="alert" className="px-2 text-xs text-red-400">
                  {session.error.message}
                </p>
              ) : null}
            </div>
            <div className="border-t border-unison-border pt-2">
              <a
                href="https://betterlyrics.org"
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text"
              >
                Get Better Lyrics
              </a>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={session.signIn}
      disabled={session.signingIn}
      className="cursor-pointer rounded-md bg-unison-bg-elevated px-3 py-1.5 text-sm font-medium text-unison-text transition-colors hover:bg-unison-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      data-state="signed-out"
    >
      Sign in with Better Lyrics
    </button>
  );
}
