#!/bin/sh

docker run --rm -v "$PWD:/var/task" --entrypoint "./scripts/rebuild-native.sh" lambci/lambda:build-nodejs6.10
