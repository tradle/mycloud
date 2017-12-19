#!/bin/bash

set -euo pipefail

REDIS_CLI=$(which redis-cli)
REDIS_SERVER=$(which redis-server)
if [ "$REDIS_CLI" == "" ] || [ "$REDIS_SERVER" == "" ]; then
  echo 'please install and run redis'
  exit 1
fi

PONG=$(redis-cli ping) || { echo 'please start redis first (run: redis-server)'; }

if [ ! -z "$PONG" ]
then
  npm run localstack:start
  sleep 5
  npm run gen:localresources
  DEBUG=λ*,*tradle* serverless offline start
fi
