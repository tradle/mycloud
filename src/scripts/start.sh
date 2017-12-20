#!/bin/bash

set -euo pipefail

REDIS_CLI=$(which redis-cli)
REDIS_SERVER=$(which redis-server)
if [ "$REDIS_CLI" == "" ] || [ "$REDIS_SERVER" == "" ]; then
  echo 'please install and run redis'
  exit 1
fi

redis-cli ping >/dev/null 2>&1 || { echo 'please start redis first (run: redis-server)'; exit 1; }
docker ps >/dev/null 2>&1 || { echo 'please start Docker first'; exit 1; }

npm run localstack:start
sleep 5
# npm run gen:localresources
DEBUG=λ*,*tradle* serverless offline start
