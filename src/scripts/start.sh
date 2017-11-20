#!/bin/bash

REDIS_CLI=$(which redis-cli)
REDIS_SERVER=$(which redis-server)
if [ "$REDIS_CLI" == "" ] || [ "$REDIS_SERVER" == "" ]; then
  echo 'please install and run redis'
  exit 1
fi

PONG=$(redis-cli ping)
if [ "$PONG" != "PONG" ]; then
  echo 'please start redis first (run: redis-server)'
  exit 1
fi

npm run setup:local && DEBUG=λ*,*tradle* serverless offline start
