#!/usr/bin/env bash

# see https://github.com/localstack/localstack#running-in-docker

if [ "$(uname)" == "Darwin" ]; then
  TMPDIR=/private$TMPDIR
fi

COMMAND="$1"

# to load docker/.env
cd docker

if [ "$COMMAND" == "up" ]; then
  docker-compose -f ./docker-compose-localstack.yml up -d
else
  docker-compose -f ./docker-compose-localstack.yml down
fi
