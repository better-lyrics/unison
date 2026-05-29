# Unison

Crowdsourced lyrics API for [Better Lyrics](https://github.com/better-lyrics/better-lyrics).

## Authentication

All write operations require signed requests using ECDSA P-256:

```json
{
  "payload": {
    "keyId": "<sha256-hash-of-public-key>",
    "timestamp": 1703520000000,
    "nonce": "<random-16+-char-string>",
    ...request data
  },
  "signature": "<base64-ecdsa-signature>",
  "publicKey": { "kty": "EC", "crv": "P-256", ... }
}
```

- `keyId`: SHA-256 hash of the public key (hex)
- `timestamp`: Must be within ±5 minutes of server time
- `nonce`: Unique per request (replay prevention)
- `signature`: ECDSA signature over the canonical JSON payload
- `publicKey`: Required on first request to register the key

## API

### Get lyrics

```
GET /lyrics?v=<videoId>
GET /lyrics?song=<song>&artist=<artist>
GET /lyrics?song=<song>&artist=<artist>&album=<album>&duration=<seconds>
```

Returns the highest-scored match. Optional `album` and `duration` narrow results.
Duration matching uses ±2s tolerance (configurable in `src/config.ts`).

### Search lyrics

Returns all matching entries sorted by score (highest first).

```
GET /lyrics/search?q=<query>
GET /lyrics/search?song=<song>&artist=<artist>
GET /lyrics/search?song=<song>&artist=<artist>&album=<album>
GET /lyrics/search?song=<song>&artist=<artist>&duration=<seconds>
```

The `q` parameter searches across video ID, ISRC, metadata (song/artist/album via trigram similarity), and lyrics content (full-text search). Results are ranked in three tiers: exact identifier match > metadata similarity > lyrics content match.

### Get by ID

```
GET /lyrics/:id
```

### Submit lyrics

Accepts TTML, LRC, or plain text via the `format` field.

```
POST /lyrics/submit
{
  "videoId": "dQw4w9WgXcQ",
  "song": "Song Title",
  "artist": "Artist Name",
  "duration": 180,
  "lyrics": "[00:15.00]First line...",
  "format": "lrc",
  "album": "Album Name",
  "language": "en",
  "syncType": "linesync"
}
```

Formats: `ttml`, `lrc`, `plain`
Sync Types: `richsync`, `linesync`, `plain`

### Vote

```
POST /lyrics/:id/vote
{ "vote": 1 }   // upvote
{ "vote": -1 }  // downvote

DELETE /lyrics/:id/vote  // remove vote
```

### Report

```
POST /lyrics/:id/report
{
  "reason": "wrong_song",
  "details": "optional"
}
```

Reasons: `wrong_song`, `bad_sync`, `offensive`, `spam`, `other`

## Response format

```json
{
  "success": true,
  "data": {
    "id": 123,
    "videoId": "dQw4w9WgXcQ",
    "song": "Never Gonna Give You Up",
    "artist": "Rick Astley",
    "lyrics": "...",
    "format": "lrc",
    "language": "en",
    "syncType": "linesync",
    "score": 5,
    "effectiveScore": 4.2,
    "voteCount": 12,
    "confidence": "high"
  }
}
```

### Confidence levels

- `low`: Fewer than 5 votes
- `medium`: 5+ votes from similar users
- `high`: 5+ votes with diversity bonus (both harsh and generous raters agree)

## Development

```
pnpm install
pnpm run dev      # local server
pnpm run test     # tests
pnpm run check    # lint
```

## Database dump

A daily snapshot of the public lyrics corpus is published at
`https://unison-dumps.boidu.dev/latest.dump`. Machine-readable index lives at
`https://unison-dumps.boidu.dev/manifest.json` (sha256, row counts, timestamp,
schema version, dump URL).

Format: PostgreSQL custom-format (`pg_dump -Fc`), Postgres 18. The dump
contains the `public_dump` schema with `lyrics`, `requested_songs`, and
`lyrics_requests` tables. User identifiers, votes, reports, and auth data
are excluded.

### Restore

```bash
# 1. Download and verify
curl -O https://unison-dumps.boidu.dev/latest.dump
curl -O https://unison-dumps.boidu.dev/latest.dump.sha256
sha256sum -c latest.dump.sha256

# 2. Create a fresh database
createdb unison_mirror

# 3. Restore (takes a couple of minutes on the current corpus size)
pg_restore -d unison_mirror --no-owner --no-privileges latest.dump

# 4. Rebuild the full-text search column and index (omitted from the dump for size)
psql unison_mirror -c "ALTER TABLE public_dump.lyrics ADD COLUMN lyrics_text_search tsvector;"
psql unison_mirror -c "UPDATE public_dump.lyrics SET lyrics_text_search = to_tsvector('simple', lyrics);"
psql unison_mirror -c "CREATE INDEX idx_lyrics_text_search ON public_dump.lyrics USING GIN (lyrics_text_search);"
```

The `lyrics` column is gzip-compressed (matches storage in the live DB).
Decompress in your client of choice.

### Production-DB safety

The dump pipeline only ever writes to the `public_dump` schema. There are no
`INSERT`, `UPDATE`, `DELETE`, or `ALTER` statements targeting `public.*` tables
anywhere in the code, and a unit test in `src/jobs/dump.test.ts` enforces this
on every change (a future write to `public.*` would fail CI).

For belt-and-suspenders, you can run the dump under a restricted Postgres role
so even a buggy code change physically cannot mutate prod tables:

```sql
CREATE ROLE unison_dump WITH LOGIN PASSWORD '<choose-one>';
GRANT USAGE ON SCHEMA public TO unison_dump;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO unison_dump;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO unison_dump;
CREATE SCHEMA IF NOT EXISTS public_dump AUTHORIZATION unison_dump;
```

Then point the dump pipeline at this role by setting `DUMP_DATABASE_URL` to a
connection string that authenticates as `unison_dump`. The pipeline falls back
to `DATABASE_URL` when `DUMP_DATABASE_URL` is unset, so the safety upgrade is
opt-in.

## License

Source code: MIT.

Lyrics database dump: dual-licensed.

- Open: [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/). Free to
  use, share, and build on with attribution and share-alike for derivative
  databases. FOSS projects displaying lyrics in a UI only owe attribution
  ("Produced Works" clause).
- Commercial: streaming services, distributors, labels, and any product
  using the corpus commercially need a commercial license. Email
  `enterprise@boidu.dev` with "Unison" in the subject.

Required attribution: `Lyrics from Unison (https://unison.boidu.dev)`.
