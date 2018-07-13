#!/bin/bash

COMMIT=$(git rev-parse HEAD)
BRANCH=$(git symbolic-ref --short HEAD)
VERSION=$(cat package.json | jq .version)

echo "{\"commit\": \"${COMMIT:0:7}\", \"tag\": $VERSION, \"branch\": \"$BRANCH\"}" \
 | jq . \
 | cat > lib/version.json
