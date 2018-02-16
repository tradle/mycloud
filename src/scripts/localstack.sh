#!/usr/bin/env bash

# see https://github.com/localstack/localstack#running-in-docker

if [ "$(uname)" == "Darwin" ]; then
  TMPDIR=/private$TMPDIR
fi

# to load docker/.env
cd docker

eval "docker-compose -f ./docker-compose-localstack.yml $@"
