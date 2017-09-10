#!/usr/bin/env bash

# see https://github.com/localstack/localstack#running-in-docker

if [ "$(uname)" == "Darwin" ]; then
  TMPDIR=/private$TMPDIR
fi

if [ "$1" == "up" ]; then
  docker-compose -f ./docker/docker-compose-localstack.yml up -d
else
  docker-compose -f ./docker/docker-compose-localstack.yml down
fi
