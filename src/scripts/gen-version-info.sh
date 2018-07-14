#!/bin/bash

COMMIT=$(git rev-parse HEAD)
BRANCH=$(git symbolic-ref --short HEAD)
VERSION=$(cat package.json | jq .version)
# OLD_VERSION=$(cat ./lib/version.json | jq .commit -r)
# OLD_TIME=$(cat lib/version.json | jq .time -r)
# if [[ "$DEPLOY" == "1" -o "$VERSION" != "$OLD_VERSION" ]]; then
  TIME=$(date --iso-8601=seconds --utc)
#   echo "updating version.json 'time' from $OLD_TIME to $TIME"
# else
#   TIME="$OLD_TIME"
# fi

echo "{\"commit\": \"${COMMIT:0:7}\", \"tag\": $VERSION, \"branch\": \"$BRANCH\", \"time\":\"$TIME\"}" \
 | jq . \
 | cat > lib/version.json
