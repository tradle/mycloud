#!/bin/bash

echo 'rebuilding native modules for lambda environment'
NODE_VERSION=$(node -p "/v(\d+)/.exec(fs.readFileSync('.nvmrc', 'utf-8'))[1]")

docker run --rm -v "$PWD:/var/task" \
  --entrypoint "./src/scripts/rebuild-native.sh" \
  -e TRADLE_BUILD="1" \
  amazon/aws-sam-cli-build-image-nodejs${NODE_VERSION}.x:latest
