#!/bin/bash

set -euo pipefail

if [[ -z "${TRADLE_LOCAL_IP:-}" ]]; then
  docker ps >/dev/null 2>&1 || { echo 'please start Docker first'; exit 1; }
fi

npm run localstack:start
npm run fix:redis
sleep 5
npm run gen:localstack
# npm run gen:localresources
npm run start:fast -- $@
