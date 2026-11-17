# AGENTS.md

Operating notes for AI agents working in this repo.

## Toolchain

- Node 20 and pnpm 9, matching CI. Use `pnpm` only, never `npm` or `yarn`.
- Server: Elysia on the `@elysiajs/node` adapter, TypeBox validation, PostgreSQL, Redis.
- Web (`web/`): React, Vite, TypeScript, Tailwind v4. It has its own `package.json` and lockfile;
  run its scripts with `pnpm -C web <script>`.
- Formatting and linting are Biome only: tabs, double quotes, no semicolons, line width 100.

## Commands

```bash
pnpm dev                   # API and web together (tsx watch + Vite)
pnpm api:dev               # API only
pnpm web:dev               # web only
pnpm db:migrate            # migrations against DATABASE_URL
pnpm vitest src/utils/lrc.test.ts   # one test file
pnpm test:integration      # integration suite against a local Postgres (DATABASE_URL)
```

## Verification gates

Run these before claiming work is done. CI runs the same checks:

```bash
pnpm typecheck && pnpm test && pnpm lint
pnpm -C web typecheck && pnpm -C web test && pnpm -C web lint && pnpm -C web build
```

## Testing

Unison is test-driven where it counts and test-light everywhere else. The suite exists to catch the
failures that hurt users and the apps that read the API: auth or signature bypasses, a key acting on
another key's lyric, lost or corrupted lyrics and revisions, wrong scores or rankings, bad TTML
accepted or good TTML rejected, broken moderation and votes, and response shapes that break existing
clients. It does not exist to restate the implementation.

### Fewer tests by default

**Adding coverage is not part of "finishing" a change.** Ship the change, run the gates, and leave
the suite alone unless one of these is true:

- The maintainer asked for a test.
- You are fixing a bug whose cause was a non-obvious logic error. One test pins that exact
  regression, named `it("regression: ...")`.
- You are adding or changing logic on a core surface where the invariant cannot be confirmed by
  reading the function: auth and signatures (`eitherAuth`, signed bodies, sessions), ownership and
  permission checks, scoring and ranking, submission and TTML validation, revisions and their
  status, votes and moderation, SQL whose result shape or filtering is easy to get wrong, and any
  change to a response shape an existing client reads.

Never write a test for: thin wrappers and delegation, route wiring that only passes values through,
presentational components, copy, constants and config plumbing, log lines, anything `tsc` already
proves, or an expected value you got by running the code.

If you think something needs coverage and it does not clearly fit above, say what you would assert
and why in your summary, and let the maintainer decide. Do not write it speculatively.

### Test first when you do test

1. Write the test and run it. It must fail, and fail for the reason you expect, not because of a
   typo or a bad import.
2. Write the minimum code that makes it pass.
3. Run it again, then run the gates.

A bug fix starts from a reproduction. If the bug qualifies for a regression test, that test is the
reproduction. If it does not, reproduce it against a running server before you change code.

### How to write one

- Extend the nearest existing test file before creating a new one. One test per behaviour.
- Prefer a unit test on the pure function over a route test. Use `app.handle` route tests when the
  behaviour is the route itself: auth, status codes, response shape.
- No mocks of project code. The in-memory adapters for `env.DB` and `env.CACHE` are the only test
  doubles; do not add new mocking layers. Mock only outbound calls to third-party services.
- Test data is realistic: real `videoId` shapes and TTML cut from real rows
  (`src/utils/__fixtures__/`). Never put real song lyrics in a fixture; invent the lines.

### Failing tests

A failing test is a signal. Never delete it, skip it, or change its assertion to match new behaviour
unless the behaviour changed on purpose and you can say why. Find the cause in production code
first. If you cannot tell why a test fails, stop and say so.

## Code conventions

- Path alias `@/` for imports (`import { config } from "@/config"`). No circular imports: break a
  cycle by moving the shared export to a third module.
- No `any`, `@ts-ignore` or `@ts-expect-error`.
- Comments are rare and explain why, never what. No commented-out code.
- No empty `catch` blocks.
- PR titles use `type(scope): brief description`. PRs are squash-merged, so the title becomes
  the commit.
- Request validation uses Elysia's TypeBox (`t`) in the route options. Signed request payloads are
  validated in the route handler after auth derivation.
- Existing response shapes are frozen: Better Lyrics and many other apps read them. Add optional
  fields and new endpoints; never rename or remove a field.
- Every concept has one owner, listed below. Search for the owner before writing anything new, and
  add a new area to "Where things live" when you create one.

## Where things live

- `src/routes/`: Elysia route handlers. `src/db/`: PostgreSQL reads and writes. `src/services/`:
  work that spans several tables or calls outside services. `src/infra/`: database, cache, rate
  limiter and env adapters. `src/jobs/`: cron and startup jobs. `src/utils/`: pure helpers.
  `src/config.ts`: every tunable value.
- `web/`: the Unison website (SPA). `web/src/lib/` holds pure logic, `web/src/components/ui.ts` the
  shared class recipes.

Every concept has one owner. Some of them, so you know the pattern:

- Ranking: `RANKING_EXPR` in `src/db/lyrics.ts`. Shared SQL predicates (what is hidden, which votes
  count): `src/db/predicates.ts`.
- Reputation: `updateReputations` in `src/db/reputation.ts` is its only writer. XP: the
  `contribution_events` ledger in `src/db/contribution-events.ts`. Tiers and levels:
  `src/utils/tiers.ts`, `src/utils/xp.ts`. Clients read these fields and never recompute them.
- Badges: `src/db/badges/`. Committee seals: `src/db/committee.ts`, `src/db/boost.ts`,
  `src/routes/marks.ts`.
- Lyric content and revisions: `src/db/lyric-revisions.ts`, `src/services/lyric-revisions.ts`.
  Suggested edits: `src/utils/lyric-patch.ts`.
- TTML checks: `src/utils/validation.ts`, repairs in `src/utils/ttml-repair.ts`. Video ids:
  `src/utils/video-id.ts`. ISRCs: `src/utils/isrc.ts`.
- Album art: `src/services/artwork.ts`. Avatars: `src/utils/avatar-url.ts`, joined only through
  `src/db/avatar-join.ts`.
- Share cards: `src/og/`. Share meta tags: `src/share-meta.ts`. Content security policy:
  `src/utils/content-security-policy.ts` (add every new third-party host there).
- Where the server and web need the same rule, each side has a copy held equal by a parity test in
  `web/src/lib/*.test.ts`. Change both.

## Gotchas

- Bodiless requests never send `content-type: application/json`. On the node adapter, any route whose derive reads `ctx.body` (e.g. `eitherAuth`) parses the empty body and returns 400. `app.handle` tests cannot catch this, since their body is null.
- Fire-and-forget safety nets: When background jobs (e.g., `recalculateScore`) are fire-and-forget with `.catch()`, the cron safety net must cover recently-affected entries, not just never-processed ones. A `WHERE score_updated_at IS NULL` filter misses entries where a previous run succeeded but the latest failed.

## Pull requests

If an AI agent wrote or substantially wrote the change, say so in the PR description, naming the
model and the person it is acting for:

> Opened by `<model name>` working on behalf of `@<github-handle>`.

Both are placeholders. Fill in the model that actually wrote the change and the GitHub handle of the
person it is acting for. Keep the line even when the human reviews and amends the work.
