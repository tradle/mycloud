#!/bin/sh

echo 'rebuilding native modules for lambda environment'
docker run --rm -v "$PWD:/var/task" --entrypoint "./src/scripts/rebuild-native.sh" lambci/lambda:build-nodejs6.10
