#!/bin/bash
# Reproduce Railway's tsx + Node 22 + pnpm + Debian container locally.
# Railway uses RAILPACK which builds on debian:bookworm-slim with Node 22.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

docker run --rm -i \
  --name eld-test \
  --memory=512m \
  --cpus=1 \
  -v "$ROOT_DIR":/app \
  -w /app \
  node:22-bookworm-slim \
  bash -c "
    set -e
    echo '== node version =='
    node --version
    echo
    echo '== Phase A: import(eld/large) =='
    cd /app
    time node --input-type=module -e \"
      const t0 = Date.now();
      const { eld } = await import('eld/large');
      console.log('loaded ms=' + (Date.now() - t0));
      eld.enableTextCleanup(true);
      console.log('detect=' + JSON.stringify(eld.detect('Hola amigo como estas hoy')));
    \"
    echo
    echo '== Phase B: import(eld) + eld.load(large) =='
    time node --input-type=module -e \"
      const t0 = Date.now();
      const { eld } = await import('eld');
      console.log('main loaded ms=' + (Date.now() - t0));
      const t1 = Date.now();
      await eld.load('large');
      console.log('large loaded ms=' + (Date.now() - t1));
      eld.enableTextCleanup(true);
      console.log('detect=' + JSON.stringify(eld.detect('Hola amigo como estas hoy')));
    \"
  "
