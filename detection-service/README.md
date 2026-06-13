# detection-service

Rust HTTP service that wraps [lingua-rs](https://github.com/pemistahl/lingua-rs) for language detection.

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

Returns 200 with `{ "status": "ok", "model_loaded": true }` once the detector is built. The service does not bind the listening port until the detector is constructed, so healthchecks cannot succeed until the service is ready.

## Configuration

- `PORT` (default `8080`): port to bind on `0.0.0.0`.
- `RUST_LOG` (default `info`): tracing-subscriber filter.

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

## Logging

Structured JSON via `tracing-subscriber`. One JSON object per line on stdout.

## Tests

```
cd detection-service
cargo test
```
