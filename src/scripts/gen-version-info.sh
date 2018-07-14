#!/bin/bash

COMMIT=$(git rev-parse HEAD)
BRANCH=$(git symbolic-ref --short HEAD)
VERSION=$(cat package.json | jq .version)
DATE=$(date --iso-8601=seconds --utc)

echo "{\"commit\": \"${COMMIT:0:7}\", \"tag\": $VERSION, \"branch\": \"$BRANCH\", \"time\":\"$DATE\"}" \
 | jq . \
 | cat > lib/version.json
