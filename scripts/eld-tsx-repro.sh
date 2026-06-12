#!/bin/bash
# Reproduce Railway: Node 22 + tsx + pnpm-installed-on-Linux + memory constraint
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

docker run --rm -i \
  --name eld-tsx-test \
  --memory=512m \
  --cpus=1 \
  -v "$ROOT_DIR":/host \
  -w /tmp/work \
  node:22-bookworm-slim \
  bash -c "
    set -e
    npm install -g pnpm@10 --silent 2>&1 | tail -3
    mkdir -p /tmp/work
    cp -r /host/. /tmp/work/
    cd /tmp/work
    rm -rf node_modules
    echo '== installing on Linux =='
    pnpm install --frozen-lockfile --ignore-scripts 2>&1 | tail -5
    echo
    cat > scripts/_eldcheck.ts << 'EOF'
import { loadEld, detectLanguage } from '@/utils/detect-language'
import { Logger } from '@/infra/logger'
const log = new Logger('test')
async function main() {
  const t0 = Date.now()
  log.info('eld load starting')
  await loadEld()
  log.info('eld load done', { ms: Date.now() - t0 })
  console.log('detect=', detectLanguage('Hola amigo como estas hoy mismo', 'plain'))
  process.exit(0)
}
main().catch(err => { console.error('FATAL', err); process.exit(1) })
EOF
    echo '== Phase A via tsx =='
    time pnpm tsx scripts/_eldcheck.ts
  "
