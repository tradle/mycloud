#!/bin/bash

echo 'rebuilding native modules for lambda environment'
docker run --rm -v "$PWD:/var/task" \
  --entrypoint "./src/scripts/rebuild-native.sh" \
  -e TRADLE_BUILD="1" \
  lambci/lambda:build-nodejs8.10
