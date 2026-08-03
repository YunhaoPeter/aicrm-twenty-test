#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

BASE_TAG="${1:-latest}"
GUARDED_TAG="${2:-guarded}"
RESOLVED_TAG="${3:-resolved}"

echo "==> [1/4] Build ${GUARDED_TAG} from twentycrm/twenty:${BASE_TAG}"
docker build -t "twentycrm/twenty:${GUARDED_TAG}" -f Dockerfile.guard .

echo "==> [2/4] Extract compiled resolver from ${GUARDED_TAG} image"
docker run --rm --entrypoint cat "twentycrm/twenty:${GUARDED_TAG}" \
  /app/packages/twenty-server/dist/engine/core-modules/admin-panel/admin-panel.resolver.js \
  > admin-panel.resolver.js

echo "==> [3/4] Apply resolver patch"
node modify_resolver.js "$(pwd)/admin-panel.resolver.js"

echo "==> [4/4] Build ${RESOLVED_TAG} from ${GUARDED_TAG}"
docker build -t "twentycrm/twenty:${RESOLVED_TAG}" -f Dockerfile.resolver .
rm -f admin-panel.resolver.js

echo "Done: twentycrm/twenty:${GUARDED_TAG} and twentycrm/twenty:${RESOLVED_TAG}"
