# detection-service

Internal Rust HTTP service that wraps [lingua-rs](https://github.com/pemistahl/lingua-rs)
for language detection. Called by the main unison API over Railway's private network.

## Why a separate service

Language detection runs sync CPU work. Running it in-process inside the main
Node API risks blocking the event loop under load. Isolating it to a separate
service means any failure mode (slow detection, hang, crash, OOM) is contained
and cannot impact the main API.

## API

### POST /detect

```
{ "text": "..." }
```

Returns:

```
{ "iso6391": "ko" | null, "confidence": 0.62 }
```

Errors: 400 on empty or missing text, with body `{ "error": "..." }`.

### POST /detect/batch

```
{ "texts": ["...", "..."] }
```

Returns:

```
{ "results": [{ "iso6391": "ko", "confidence": 0.62 }, ...] }
```

Errors: 400 on empty array, 413 on more than 200 items. Both carry a JSON body `{ "error": "..." }`.

Items where text is empty or whitespace-only return `{ "iso6391": null, "confidence": 0.0 }` in their result slot instead of failing the whole batch.

### GET /health

Returns 200 with `{ "status": "ok", "model_loaded": true }` once the detector
is built. The service does not bind the listening port until the detector is
constructed, so Railway's healthcheck cannot succeed until the service is ready.

## Running locally

```
cd detection-service
cargo run --release
```

Smoke test:

```
curl http://localhost:8080/health
curl -X POST http://localhost:8080/detect \
  -H 'content-type: application/json' \
  -d '{"text": "안녕하세요 오늘 날씨가 좋네요"}'
curl -X POST http://localhost:8080/detect/batch \
  -H 'content-type: application/json' \
  -d '{"texts": ["Hello world", "안녕하세요", "Xin chào"]}'
```

## Railway deployment

In the Railway project that hosts unison:

1. Create a new service.
2. Point it at this same repo, root directory `detection-service/`.
3. Railpack autodetects Rust from `Cargo.toml` and builds with `cargo build --release`.
4. Set healthcheck path to `/health`.
5. Service binds to `$PORT` automatically.
6. Use private network only: do not expose a public domain.
7. Internal hostname will be something like `detection.railway.internal:8080`.

## Logging

Structured JSON via `tracing-subscriber`. Default level `info`, overridable via
`RUST_LOG` env var.

## Tests

```
cd detection-service
cargo test
```
