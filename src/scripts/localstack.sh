#!/usr/bin/env bash

# see https://github.com/localstack/localstack#running-in-docker

if [ "$(uname)" == "Darwin" ]; then
  TMPDIR=/private$TMPDIR
fi

COMPOSE_PROJECT_NAME=$(basename $(pwd))
# to load docker/.env
cd docker
eval "COMPOSE_PROJECT_NAME=\"$COMPOSE_PROJECT_NAME\" docker-compose -f ./docker-compose-localstack.yml $@"
